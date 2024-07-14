import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { Strategy as BearerStrategy } from 'passport-http-bearer';
import { config } from './config';
import fromExtractors = ExtractJwt.fromExtractors;
import { prisma } from './prisma';
import { cron } from './scheduler';
import { ExecutionContext } from './plugin';
import { readYaml } from './fileUtils';
import bcrypt from 'bcryptjs';
import { User } from '@prisma/client';
import { notify } from './notifications';
import Jwt, { JwtPayload } from 'jsonwebtoken';

type CookieRequest = { cookies: { [key: string]: string } };

const fromCookieAsToken = (req: CookieRequest) => {
  if (req && req.cookies) {
    return req.cookies['access-token'];
  } else {
    return null;
  }
};

const purgeExpiredTokens = async () => {
  prisma.expiredTokens.deleteMany({
    where: {
      expiredSince: {
        lt: new Date(Date.now() - config.auth.sessionMaxAgeSeconds * 1000),
      },
    },
  });
};
purgeExpiredTokens().then(() => {
  cron('0 0 0 * * *', purgeExpiredTokens);
});

export const jwt = () => {
  const JWT_SECRET = config.env['JWT_SECRET'] as unknown as string;
  const options = {
    jwtFromRequest: fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), fromCookieAsToken]),
    secretOrKey: JWT_SECRET,
    issuer: config.auth.issuer,
    audience: config.app.domain,
    passReqToCallback: true,
  };

  //@ts-ignore
  return new JwtStrategy(options, async (req, jwtPayload, done) => {
    try {
      const token = req.header('Authorization')?.substring(7) || req.cookies['access-token'];
      const expiredToken = await prisma.expiredTokens.findUnique({
        where: { token },
      });
      if (expiredToken) {
        done(null, null);
      } else {
        const user = await prisma.user.findUnique({
          include: {
            authSchemes: true,
          },
          where: {
            uid: jwtPayload.sub as string,
          },
        });
        done(null, user);
      }
    } catch (error) {
      done(error, null);
    }
  });
};

// export const bearer = () => {
//   return new BearerStrategy((token, done) => {
//     if(token === 'Whatever') {
//
//     }
//   });
// }

export default function (this: ExecutionContext) {
  const findAuthByScheme = async (scheme: string, username: string) => {
    return prisma.authScheme.findUnique({
      include: { user: true },
      where: {
        scheme_username: {
          scheme,
          username,
        },
      },
    });
  };
  const createUser = async (scheme: string, username: string, secret: string) => {
    return prisma.user.create({
      data: {
        authSchemes: {
          create: {
            scheme,
            username,
            secret,
          },
        },
      },
    });
  };
  const findUserByUid = (uid: string, enabled = true) => {
    return prisma.user.findUnique({
      where: { uid, enabled },
    });
  };
  const createAccessToken = (user: User, secret: string) => {
    return Jwt.sign(
      {
        displayName: user.displayName,
        permissions: [],
      },
      secret,
      {
        subject: user.uid,
        issuer: config.auth.issuer,
        audience: config.app.domain,
        expiresIn: config.auth.tokenMaxAgeSeconds,
      }
    );
  };
  const createRefreshToken = (user: User, secret: string) => {
    return Jwt.sign({}, secret, {
      subject: user.uid,
      issuer: config.auth.issuer,
      audience: config.app.domain,
      expiresIn: config.auth.sessionMaxAgeSeconds,
    });
  };

  this.onStart(async () => {
    const defaultUsers = readYaml('./config/users.yaml');
    if (defaultUsers) {
      return Promise.allSettled(
        defaultUsers.users.map(async (user: string) => {
          const [username, secret] = user.split('/');
          if (username.trim().length > 0 && secret.trim().length > 0) {
            const user = await findAuthByScheme('local', username);
            if (user == null) {
              const hashedPassword = await bcrypt.hash(secret, 12);
              await createUser('local', username, hashedPassword);
            }
          }
        })
      );
    }
  });

  this.useEndpoint('post', '/login', async (req, res) => {
    const JWT_SECRET = config.env['JWT_SECRET'] as unknown as string;
    let refreshToken = req.cookies['refresh-token'];
    let user: User | null = null;
    if (refreshToken) {
      const payload = Jwt.verify(refreshToken, JWT_SECRET, {
        audience: config.app.domain,
        clockTolerance: 6000,
      });
      user = await findUserByUid(payload.sub as string);
    } else if (req.body) {
      const { username, password } = req.body;
      if (username && username.trim().length > 0 && password && password.trim().length > 0) {
        const auth = await findAuthByScheme('local', username);
        if (auth && bcrypt.compareSync(password, auth.secret)) {
          user = auth.user.enabled ? auth.user : null;
        }
      } else {
        res.status(400).send({
          message: 'Expects username and password',
        });
        return;
      }
    } else {
      res.status(400).send({ message: 'Expects username and password or refresh-token in cookie' });
      return;
    }

    if (user) {
      if (!refreshToken) {
        refreshToken = createRefreshToken(user, JWT_SECRET);
      }
      const accessToken = createAccessToken(user, JWT_SECRET);
      res
        .status(200)
        .cookie('access-token', accessToken, {
          maxAge: config.auth.tokenMaxAgeSeconds * 1000,
          httpOnly: true,
          secure: true,
        })
        .cookie('refresh-token', refreshToken, {
          maxAge: config.auth.sessionMaxAgeSeconds * 1000,
          httpOnly: true,
          secure: true,
        })
        .json({
          accessToken: accessToken,
          refreshToken: refreshToken,
        });
    } else {
      res.status(401);
    }
  }).withAuthentication(null);

  this.useEndpoint('post', '/logout', async (req, res) => {
    const accessToken = req.header('Authorization') || req.cookies['access-token'];
    const refreshToken = req.cookies['refresh-token'];
    if (accessToken) {
      await prisma.expiredTokens.upsert({
        where: { token: accessToken },
        create: { token: accessToken },
        update: {},
      });
    }
    if (refreshToken) {
      await prisma.expiredTokens.upsert({
        where: { token: refreshToken },
        create: { token: refreshToken },
        update: {},
      });
    }
    res.status(200).clearCookie('access-token').clearCookie('refresh-token').end();
  });

  this.useEndpoint('post', '/password', async (req, res) => {
    const user = req.user as User;
    const { oldPassword, newPassword } = req.body as {
      oldPassword: string;
      newPassword: string;
    };
    if (!oldPassword || !newPassword) {
      res.status(400).send({ message: 'Expects oldPassword and newPassword' });
      return;
    }

    try {
      const auth = await prisma.authScheme.findUnique({
        where: {
          scheme_userId: {
            scheme: 'local',
            userId: user.id,
          },
        },
      });

      if (auth && bcrypt.compareSync(oldPassword, auth.secret)) {
        await prisma.authScheme.update({
          where: {
            id: auth.id,
          },
          data: {
            secret: bcrypt.hashSync(newPassword, 12),
          },
        });
        res.status(200).end();
      } else {
        res.status(401).json({
          message: 'Old password mismatch',
        });
      }
    } catch (error) {
      res.status(500).json(error);
    }
  });

  this.useEndpoint('post', '/forgotPassword', async (req, res) => {
    const { username } = req.body;
    if (!username) {
      res.status(400).send({ message: 'Expects username' });
      return;
    }
    const auth = await findAuthByScheme('local', username);
    if (auth) {
      const newPassword = Math.random().toString(36).substring(2);
      await prisma.authScheme.update({
        where: {
          id: auth.id,
        },
        data: {
          secret: bcrypt.hashSync(newPassword, 12),
        },
      });
      await notify(auth.user)
        .withMessage('forgotPassword', {
          username: auth.username,
          password: newPassword,
        })
        .overChannel('email')
        .send();
    }
  });
}
