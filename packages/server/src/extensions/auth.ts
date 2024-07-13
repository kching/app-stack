import { ExecutionContext } from "../platform/plugin";
import { readYaml } from "../platform/fileUtils";
import { prisma } from "../platform/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../platform/config";

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
      authMethods: {
        create: {
          scheme,
          username,
          secret,
        },
      },
    },
  });
};

export default function (this: ExecutionContext) {
  this.onStart(async () => {
    const defaultUsers = readYaml("./config/users.yaml");
    if (defaultUsers) {
      return Promise.allSettled(
        defaultUsers.users.map(async (user: string) => {
          const [username, secret] = user.split("/");
          if (username.trim().length > 0 && secret.trim().length > 0) {
            const user = await findAuthByScheme("local", username);
            if (user == null) {
              const hashedPassword = await bcrypt.hash(secret, 12);
              await createUser("local", username, hashedPassword);
            }
          }
        }),
      );
    }
  });

  this.useEndpoint("post", "/login", async (req, res) => {
    if (req.body == null) {
      res.status(400).send({ message: "Expects username and password" });
      return;
    }
    const { username, password } = req.body;
    const auth = await findAuthByScheme("local", username);
    const JWT_SECRET = config.env["JWT_SECRET"] as unknown as string;
    if (auth && bcrypt.compareSync(password, auth.secret)) {
      const token = jwt.sign(
        {
          displayName: auth.user.displayName,
        },
        JWT_SECRET,
        {
          subject: auth.user.uid,
          issuer: config.auth.issuer,
          audience: config.app.domain,
          expiresIn: config.auth.tokenMaxAge,
        },
      );
      res
        .status(200)
        .cookie("access-token", token, {
          maxAge: config.auth.tokenMaxAge * 1000,
          httpOnly: true,
          secure: true,
        })
        .json({
          accessToken: token,
        });
    } else {
      res.status(401).json({
        _links: {
          login: "/login",
        },
      });
    }
  }).withAuthentication(null);

  this.useEndpoint("post", "/logout", async (req, res) => {
    const token = req.header("Authorization") || req.cookies["access-token"];
    if (token) {
      await prisma.expiredTokens.upsert({
        where: { token },
        create: { token },
        update: {},
      });
    }
    res.status(200).clearCookie("access-token").end();
  });
}
