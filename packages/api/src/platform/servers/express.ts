import { Endpoint } from '../plugin';
import { createWebSocketServer, WebSocketEndpoint } from '../webSockets';
import express, { json } from 'express';
import { createServer, Server } from 'http';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { jwt } from '../services/userManagement/auth';
import { config } from '../config';
import { getLogger } from '../logger';
import { validateRequest } from '../validation';

const logger = getLogger('Express Server');
const app = express();
const httpServer = createServer(app);
const webSocketServer = createWebSocketServer(httpServer);

const router = express.Router({});
router.use(json());
router.use(cookieParser());
router.use(passport.initialize());
passport.use(jwt());

const registerEndpoint = (endpoint: Endpoint) => {
  const { method, authProviders, requestBodySchema, handlers } = endpoint;
  let path = endpoint.path;
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  const func = (router as { [key: string]: any })[method.toLowerCase()];
  if (typeof func === 'function') {
    logger.debug(`Registering endpoint ${method.toUpperCase()} ${path}`);
    const middlewares = [];
    if (authProviders != null && authProviders.length > 0) {
      const auth = passport.authenticate(authProviders, { session: false });
      middlewares.push(auth);
    }
    if (requestBodySchema != null) {
      middlewares.push(validateRequest(requestBodySchema));
    }
    func.call(router, path, ...middlewares, ...handlers);
  }
};

const unregisterEndpoint = (endpoint: Endpoint) => {
  const { path } = endpoint;
  let paths = router.stack.map((layer) => layer.route?.path);
  while (paths.indexOf(path) > -1) {
    router.stack.splice(paths.indexOf(path));
    paths = router.stack.map((layer) => layer.route?.path);
  }
};

const registerWebSocket = (wsEndpoint: WebSocketEndpoint) => {
  webSocketServer.register(wsEndpoint);
};
const unregisterWebSocket = (wsEndpoint: WebSocketEndpoint) => {
  webSocketServer.unregister(wsEndpoint);
};

const start = (apiRoot: string, port?: number, callBack?: (server: Server) => void | Promise<void>) => {
  const resolvedPort = port ?? config.app.port;
  app.use(json());
  app.use(cookieParser());
  app.use(apiRoot, router);
  httpServer.listen(resolvedPort, async () => {
    getLogger().info(`App server running on port ${resolvedPort}`);
    if (typeof callBack === 'function') {
      await callBack(httpServer);
    }
  });
};
const stop = (sig: 'SIGINT' | 'SIGQUIT' | 'SIGTERM') => {
  return new Promise<'SIGINT' | 'SIGQUIT' | 'SIGTERM'>((resolve) => {
    httpServer.close(() => resolve(sig));
  });
};

export const server = { registerEndpoint, unregisterEndpoint, registerWebSocket, unregisterWebSocket, start, stop };
