import path from 'path';
import { RequestHandler, Router } from 'express';
import { getLogger } from './logger';
import { scanForFiles } from './fileUtils';
import { WebSocketHandler, WebSocketRouter } from './wsRouter';
import { Logger } from 'winston';
import { cron, delay } from './scheduler';
import { ScheduledTask } from 'node-cron';
import passport from 'passport';

export type HttpMethod = 'all' | 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

class EndpointRegistration {
  method: HttpMethod;
  path: string;
  handlers: RequestHandler[];
  authProviders: string[] | null = ['jwt'];

  constructor(method: HttpMethod, path: string, handlers: RequestHandler[]) {
    this.method = method;
    this.path = path;
    this.handlers = handlers;
  }
  withAuthentication(auth: string | string[] | null) {
    if (auth == null || Array.isArray(auth)) {
      this.authProviders = auth;
    } else {
      this.authProviders = [auth];
    }
  }
}

type WebSocketEndpointRegistration = {
  path: string;
  handler: WebSocketHandler;
};

type PluginStatus = 'created' | 'starting' | 'started' | 'stopping' | 'stopped';

export type ExecutionContext = {
  id: string;
  logger: Logger;
  onStart: typeof Plugin.prototype.onStart;
  onStop: typeof Plugin.prototype.onStop;
  useEndpoint: typeof Plugin.prototype.useEndpoint;
  useWebSocket: typeof Plugin.prototype.useWebsocket;
  scheduleTask: (schedule: number | string, task: () => void) => void;
};

type PluginFunction = (this: ExecutionContext, options?: { [key: string]: any }) => Promise<void> | void;

const logger = getLogger();

const registerEndpoint = (router: Router, { method, path, authProviders, handlers }: EndpointRegistration) => {
  const func = (router as { [key: string]: any })[method.toLowerCase()];
  if (typeof func === 'function') {
    logger.debug(`Registering endpoint ${method.toUpperCase()} ${path}`);
    if (authProviders != null && authProviders.length > 0) {
      const auth = passport.authenticate(authProviders, { session: false });
      func.call(router, path, auth, ...handlers);
    } else {
      func.call(router, path, ...handlers);
    }
  }
};

export const initialise = async (pluginLocation: string, options: { [key: string]: any } = {}) => {
  const pluginFiles = await scanForFiles(pluginLocation, (file) => {
    return file.name.endsWith('.ts');
  });
  return Promise.allSettled(
    pluginFiles.map(async (pluginPath) => {
      const extension = pluginPath.lastIndexOf('.');
      const id = pluginPath.slice(pluginLocation.length - 1, extension > -1 ? extension : pluginPath.length - 1);
      const importPath = path.relative(__dirname, pluginPath);
      try {
        const module = await import(importPath);
        return new Plugin(id, module.default, options);
      } catch (error) {
        logger.error('Failed to load extension', error);
      }
    })
  );
};

const scheduleTask = (schedule: number | string, task: () => void): Promise<void> | ScheduledTask => {
  if (typeof schedule === 'number') {
    return delay(schedule, task);
  } else {
    return cron(schedule, task);
  }
};

const createContext = (plugin: Plugin): ExecutionContext => ({
  id: plugin.id,
  logger: getLogger(plugin.id),
  onStart: Plugin.prototype.onStart.bind(plugin),
  onStop: Plugin.prototype.onStop.bind(plugin),
  useEndpoint: Plugin.prototype.useEndpoint.bind(plugin),
  useWebSocket: Plugin.prototype.useWebsocket.bind(plugin),
  scheduleTask: scheduleTask,
});

export class Plugin {
  private readonly _id;
  private readonly endpoints: EndpointRegistration[] = [];
  private readonly webSocketEndpoints: WebSocketEndpointRegistration[] = [];
  private readonly options: { [key: string]: any } = {};
  private readonly executionContext: ExecutionContext;
  private readonly init: Promise<string>;

  private _status: PluginStatus = 'created';
  private router?: Router;
  private wsRouter?: WebSocketRouter;
  private startCallback?: (context?: ExecutionContext, options?: { [key: string]: any }) => void | Promise<void>;
  private stopCallback?: (context?: ExecutionContext, options?: { [key: string]: any }) => void | Promise<void>;

  constructor(id: string, func: PluginFunction, options: { [key: string]: any } = {}) {
    this._id = id;
    this.options = options;

    this.executionContext = createContext(this);
    this.init = new Promise((resolve, reject) => {
      resolve(func.call(this.executionContext, options));
    })
      .then(() => 'ready')
      .catch((error) => {
        logger.warn(`Failed to load plugin ${id}`, error);
        return 'failed';
      });
  }

  get id(): string {
    return this._id;
  }

  get status(): PluginStatus {
    return this._status;
  }

  withRouter(router: Router) {
    this.router = router;
    return this;
  }

  withWebSocketRouter(wsRouter: WebSocketRouter) {
    this.wsRouter = wsRouter;
    return this;
  }

  async start() {
    const init = await this.init;
    if (init === 'ready' && (this.status === 'created' || this.status === 'stopped')) {
      this._status = 'starting';
      getLogger(this.id).debug('Starting...');
      this.endpoints.forEach((reg) => {
        if (this.router != null) {
          registerEndpoint(this.router, reg);
        }
      });
      this.webSocketEndpoints.forEach(({ path, handler }) => {
        if (this.wsRouter != null) {
          this.wsRouter.registerEndpoint(path, handler);
        }
      });
      if (typeof this.startCallback === 'function') {
        await this.startCallback(this.executionContext, this.options);
      }
      this._status = 'started';
    }
  }

  async stop() {
    if (this._status === 'started') {
      this._status = 'stopping';
      getLogger(this.id).debug('Stopping...');
      if (typeof this.stopCallback === 'function') {
        await this.stopCallback(this.executionContext, this.options);
      }
      this.endpoints
        .map((endpoint) => endpoint.path)
        .forEach((path) => {
          if (this.router && this.router.stack) {
            let paths = this.router.stack.map((layer) => layer.route?.path);
            while (paths.indexOf(path) > -1) {
              this.router.stack.splice(paths.indexOf(path));
              paths = this.router.stack.map((layer) => layer.route?.path);
            }
          }
        });
      if (this.wsRouter) {
        this.webSocketEndpoints.forEach((endpoint) => {
          // this.wsRouter.unregisterEndpoint(...)
        });
      }
      this._status = 'stopped';
    }
  }

  useEndpoint(method: HttpMethod, path: string, ...handlers: RequestHandler[]) {
    const reg = new EndpointRegistration(method, path, handlers);
    this.endpoints.push(reg);
    if (this.router && this._status === 'started') {
      registerEndpoint(this.router, reg);
    }
    return reg;
  }

  useWebsocket(path: string, handler: WebSocketHandler) {
    this.webSocketEndpoints.push({ path, handler });
    if (this.wsRouter && this._status === 'started') {
      this.wsRouter.registerEndpoint(path, handler);
    }
  }

  onStart(handler: (context?: ExecutionContext, options?: { [key: string]: any }) => void | Promise<any>) {
    this.startCallback = handler;
  }

  onStop(handler: (context?: ExecutionContext, options?: { [key: string]: any }) => void | Promise<any>) {
    this.stopCallback = handler;
  }
}
