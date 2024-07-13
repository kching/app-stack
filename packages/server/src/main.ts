import express, { json, static as staticResource } from 'express';
import cookieParser from 'cookie-parser';
import plugins from './plugin';
import { config } from './config';
import { getLogger } from './logger';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocketRouter from './wsRouter';
import passport from 'passport';
import 'dotenv/config';
import { prisma } from './prisma';
import jwt from 'jsonwebtoken';
const app = express();
const port = config.app.port;
const router = express.Router({});

passport.use(
  new BearerStrategy<VerifyFunctionWithRequest>({ passReqToCallback: true }, async (req, token, done) => {
    if (isAuthenticated(token)) {
      if (isJwtToken(token)) {
        const { sub } = jwt.verify(token, process.env.JWT_SECRET as string);
        const user = await prisma.user.findUnique({
          where: {
            email: sub as string,
          },
        });
        done(null, user);
      } else {
        done(null, {});
      }
    } else {
      done(null, false);
    }
  })
);

router.use(json());
router.use(cookieParser());
router.use(passport.initialize());
router.use(passport.authenticate('bearer', { session: false }));

const httpServer = createServer(app);
const websocketServer = new WebSocketServer({ server: httpServer });
const wsRouter = WebSocketRouter(websocketServer);

const options = {
  router,
  wsRouter,
  pluginOptions: config.plugins,
};

plugins.initialise('./src/plugins', options).then(() => {
  app.use(json());
  app.use(staticResource('public'));
  app.use(cookieParser());
  app.use('/api/v1', router);
  httpServer.listen(port, () => {
    getLogger().info(`App server running on port ${port}`);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received');
  httpServer.close();
  httpServer.closeAllConnections();
});
