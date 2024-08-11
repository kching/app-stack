import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { config } from '../../config';
import { platformPrisma as prisma } from '../../prisma';
import { Service } from '../../plugin';
import bcrypt from 'bcryptjs';
import { User } from '@prisma/client';
import { notifyContact } from '../notifications';
import Jwt from 'jsonwebtoken';
import fromExtractors = ExtractJwt.fromExtractors;
import { findUserByUid } from './userGroups';
import { publish } from '../../events';
import { getLogger } from '../../logger';
import fs from 'fs';
import { randomBytes } from 'node:crypto';
import { SecurityContext } from '../../accessControl';

export type UserContext = {
  userUid: string;
  securityContext: SecurityContext;
};

type CookieRequest = { cookies: { [key: string]: string } };

let jwtSecret: string | Buffer | undefined = undefined;
const getJwtSecret = () => {
  if (jwtSecret == null) {
    const envJwtSecret = config.env['JWT_SECRET'] as unknown as string;
    if (envJwtSecret == null || envJwtSecret.trim().length === 0) {
      jwtSecret = randomBytes(32).toString('hex');
    } else if (envJwtSecret.startsWith('file://')) {
      jwtSecret = fs.readFileSync(envJwtSecret.substring('file://'.length));
    } else {
      jwtSecret = envJwtSecret;
    }
  }
  return jwtSecret;
};

const fromCookieAsToken = (req: CookieRequest) => {
  if (req && req.cookies) {
    return req.cookies['next-auth.session-token'];
  } else {
    return null;
  }
};

export const jwt = () => {
  const options = {
    jwtFromRequest: fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), fromCookieAsToken]),
    secretOrKey: getJwtSecret(),
    issuer: config.auth.issuer,
    audience: config.app.domain,
    passReqToCallback: true,
  };

  //@ts-ignore
  return new JwtStrategy(options, async (req, jwtPayload, done) => {
    try {
      const user = await prisma.user.findUnique({
        include: {
          authSchemes: true,
        },
        where: {
          uid: jwtPayload.sub as string,
        },
      });
      if (user) {
        const securityContext = new SecurityContext(user.uid);
        return {
          userUid: user.uid,
          securityContext,
        };
      } else {
        done(null, null);
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

export const findAuthByScheme = async (scheme: string, username: string) => {
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

const createAccessToken = async (user: User) => {
  return Jwt.sign(
    {
      displayName: user.displayName,
      permissions: [],
    },
    getJwtSecret(),
    {
      subject: user.uid,
      issuer: config.auth.issuer,
      audience: config.app.domain,
      expiresIn: config.auth.tokenMaxAgeSeconds,
    }
  );
};

const createRefreshToken = async (user: User) => {
  return Jwt.sign({}, getJwtSecret(), {
    subject: user.uid,
    issuer: config.auth.issuer,
    audience: config.app.domain,
    expiresIn: config.auth.sessionMaxAgeSeconds,
  });
};

export async function init(this: Service) {
  this.setId('platform/auth');
  const rootSecurityContext = new SecurityContext(config.auth.rootUser);
  this.useEndpoint('post', '/login', async (req, res) => {
    let user: User | null = null;
    if (req.body) {
      const { username, password } = req.body;
      if (username && username.trim().length > 0 && password && password.trim().length > 0) {
        const auth = await findAuthByScheme('local', username);
        if (auth && bcrypt.compareSync(password, auth.secret)) {
          user = auth.user.enabled ? auth.user : null;
          if (user) {
            publish('auth.loggedIn', { userUid: user.uid });
          }
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
      const accessToken = await createAccessToken(user);
      res
        .status(200)
        .cookie('access-token', accessToken, {
          maxAge: config.auth.tokenMaxAgeSeconds * 1000000,
          httpOnly: true,
          secure: true,
        })
        .json({
          uid: user.uid,
          displayName: user.displayName,
          accessToken: accessToken,
        });
    } else {
      res.status(401).end();
    }
  }).withAuthentication(null);

  this.useEndpoint('post', '/logout', async (req, res) => {
    const user = req.user as { uid: string };
    res.status(200).clearCookie('access-token').clearCookie('refresh-token').end();
    publish('auth.loggedOut', { userUid: user.uid });
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
      const contact = await prisma.contact.findFirst({
        where: {
          userId: auth.user.id,
          passwordRecovery: true,
        },
      });
      if (contact) {
        await notifyContact(contact.uid, 'forgotPassword', {
          username: auth.username,
          password: newPassword,
        });
      } else {
        getLogger('Auth').info(`New password for ${auth.username} is ${newPassword}`);
      }
    }
  });
}
