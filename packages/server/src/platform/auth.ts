import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { Strategy as BearerStrategy } from "passport-http-bearer";
import { config } from "./config";
import fromExtractors = ExtractJwt.fromExtractors;
import { prisma } from "./prisma";
import { cron } from "./scheduler";

type CookieRequest = { cookies: { [key: string]: string } };

const fromCookieAsToken = (req: CookieRequest) => {
  if (req && req.cookies) {
    return req.cookies["access-token"];
  } else {
    return null;
  }
};

const purgeExpiredTokens = async () => {
  prisma.expiredTokens.deleteMany({
    where: {
      expiredSince: {
        lt: new Date(Date.now() - config.auth.tokenMaxAge * 1000),
      },
    },
  });
};

purgeExpiredTokens().then(() => {
  cron("0 0 0 * * *", purgeExpiredTokens);
});

export const jwt = () => {
  const JWT_SECRET = config.env["JWT_SECRET"] as unknown as string;
  const options = {
    jwtFromRequest: fromExtractors([
      ExtractJwt.fromAuthHeaderAsBearerToken(),
      fromCookieAsToken,
    ]),
    secretOrKey: JWT_SECRET,
    issuer: config.auth.issuer,
    audience: config.app.domain,
    passReqToCallback: true,
  };

  //@ts-ignore
  return new JwtStrategy(options, async (req, jwtPayload, done) => {
    try {
      const token =
        req.header("Authorization")?.substring(7) ||
        req.cookies["access-token"];
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
