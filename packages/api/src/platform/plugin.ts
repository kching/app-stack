import path from 'path';
import { RequestHandler, Router } from 'express';
import { getLogger } from './logger';
import { scanForFiles } from './fileUtils';
import { UseWebSocketOptions, WebSocketProxy, WSServer } from './webSockets';
import { Logger } from 'winston';
import { schedule, ScheduledTask } from 'node-cron';
import passport from 'passport';
import { config } from './config';
import { isMatch } from 'micromatch';
import { clearInterval } from 'node:timers';
import { Resource } from './resources';
import { Platform } from './index';
import { ZodObject } from 'zod';
import { validateRequest } from './validation';

export type HttpMethod = 'all' | 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

class EndpointRegistration {
  method: HttpMethod;
  path: string;
  handlers: RequestHandler[];
  authProviders: string[] | null = ['jwt'];
  requestBodySchema: ZodObject<any> | undefined;

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
  withValidation(schema: ZodObject<any>) {
    this.requestBodySchema = schema;
  }
}

type PluginStatus = 'created' | 'starting' | 'started' | 'stopping' | 'stopped';

const allPlugins: { [pluginId: string]: Plugin } = {};

export type Service = {
  get id(): string;
  set id(value: string);
  setId: (id: string) => void;
  logger: Logger;
  onStart: typeof Plugin.prototype.onStarted;
  onStop: typeof Plugin.prototype.onStopping;
  useEndpoint: typeof Plugin.prototype.useEndpoint;
  useWebSocket: typeof Plugin.prototype.useWebSocket;
  scheduleTask: (schedule: number | string, task: () => void) => void;
  getResource: (path: string) => Promise<Resource[]>;
};

type PluginFunction = (this: Service, options?: { [key: string]: any }) => Promise<void> | Promise<string[]> | void;

const logger = getLogger();

const registerEndpoint = (
  router: Router,
  { method, path, authProviders, requestBodySchema, handlers }: EndpointRegistration
) => {
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

export const initialise = async (
  platform: Platform,
  extensionLocation: string,
  options: { [key: string]: any } = {}
) => {
  options = { ...options, platform };
  const pluginFiles = await scanForFiles(extensionLocation, (file) => {
    return isMatch(file.name, config.app.extensionFilePattern);
  });
  return Promise.allSettled(
    pluginFiles.map(async (pluginPath) => {
      const extension = pluginPath.lastIndexOf('.');
      const id =
        (options.idPrefix ?? '') +
        pluginPath.slice(extensionLocation.length - 1, extension > -1 ? extension : pluginPath.length - 1);
      let importPath = path.relative(__dirname, pluginPath);
      if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
        importPath = './' + importPath;
      }
      try {
        const module = await import(importPath);
        if (typeof module.init === 'function') {
          return new Plugin(id, module.init, options);
        }
        return null;
      } catch (error) {
        logger.error('Failed to load extension', error);
      }
    })
  );
};

const createContext = (plugin: Plugin, platform: Platform): Service => ({
  id: plugin.id,
  setId: (value: string) => {
    plugin.id = value;
  },
  logger: getLogger(plugin.id),
  onStart: Plugin.prototype.onStarted.bind(plugin),
  onStop: Plugin.prototype.onStopping.bind(plugin),
  useEndpoint: Plugin.prototype.useEndpoint.bind(plugin),
  useWebSocket: Plugin.prototype.useWebSocket.bind(plugin),
  scheduleTask: Plugin.prototype.scheduleTask.bind(plugin),
  getResource: platform?.getResourceResolver()?.resolve,
});

export class PluginInitialisationError extends Error {
  private readonly _plugin: string;
  private readonly _status: string;
  private readonly _dependencyChain: string[];

  constructor(plugin: string, status: string, dependencyChain: string[]) {
    super();
    this._plugin = plugin;
    this._status = status;
    this._dependencyChain = dependencyChain;
  }
  get plugin() {
    return this._plugin;
  }
  get status() {
    return this._status;
  }
  get dependencyChain() {
    return this._dependencyChain;
  }
}

export class Plugin {
  private readonly endpoints: EndpointRegistration[] = [];
  private readonly webSocketProxies: WebSocketProxy[] = [];
  private readonly cronTasks: ScheduledTask[] = [];
  private readonly intervalTasks: { repeat: number; func: () => void; intervalId?: NodeJS.Timeout }[] = [];
  private readonly options: { [key: string]: any } = {};
  private readonly executionContext: Service;
  private readonly init: Promise<string>;

  private _id;
  private dependsOn: string[] = [];
  private _status: PluginStatus = 'created';
  private router?: Router;
  private webSocketServer?: WSServer;
  private startCallback?: (context?: Service, options?: { [key: string]: any }) => void | Promise<void>;
  private stopCallback?: (context?: Service, options?: { [key: string]: any }) => void | Promise<void>;

  constructor(id: string, func: PluginFunction, options: { [key: string]: any } = {}) {
    this._id = id;
    this.options = options;

    this.executionContext = createContext(this, options.platform);
    this.init = new Promise<string[] | void>((resolve) => {
      resolve(func.call(this.executionContext, options));
    })
      .then((dependsOn) => {
        if (Array.isArray(dependsOn)) {
          this.dependsOn = dependsOn;
        }
        if (allPlugins[this._id] != null) {
          logger.error(`Plugin ID conflict: Multiple plugins have the same ID ${this._id}`);
        }
        allPlugins[this._id] = this;
        return 'ready';
      })
      .catch((error) => {
        logger.warn(`Failed to load plugin ${this._id}`, error);
        return 'failed';
      });
  }

  get id(): string {
    return this._id;
  }

  set id(id: string) {
    this._id = id;
  }

  get status(): PluginStatus {
    return this._status;
  }

  withRouter(router: Router) {
    this.router = router;
    return this;
  }

  withWebSocket(webSocketServer: WSServer) {
    this.webSocketServer = webSocketServer;
    return this;
  }

  async start(dependencyChain: string[] = []) {
    const init = await this.init;
    if (init === 'ready' && (this.status === 'created' || this.status === 'stopped')) {
      this._status = 'starting';
      dependencyChain.push(this.id);
      getLogger(this.id).debug('Starting...');

      await Promise.all(
        this.dependsOn.map((dependency) => {
          const dependPlugin = allPlugins[dependency];
          if (dependPlugin) {
            if (this.router) {
              dependPlugin.withRouter(this.router);
            }
            if (this.webSocketServer) {
              dependPlugin.withWebSocket(this.webSocketServer);
            }
            return dependPlugin.start(dependencyChain);
          } else {
            getLogger(this.id).error(`Failed to start plugin. Dependency ${dependency} not found.`);
            throw new Error(`Dependency for plugin ${this.id} not found: ${dependency} `);
          }
        })
      );
      this.endpoints.forEach((reg) => {
        if (this.router != null) {
          registerEndpoint(this.router, reg);
        }
      });
      this.webSocketProxies.forEach((wsProxy) => {
        if (this.webSocketServer != null) {
          this.webSocketServer.register(wsProxy);
        }
      });

      this.cronTasks.forEach((task) => task.start());
      this.intervalTasks.forEach((task) => {
        task.intervalId = setInterval(task.func, task.repeat);
      });
      if (typeof this.startCallback === 'function') {
        await this.startCallback(this.executionContext, this.options);
      }
      this._status = 'started';
    } else if (this.status === 'starting') {
      throw new PluginInitialisationError(this.id, this.status, dependencyChain);
    }
  }

  async stop() {
    if (this._status === 'started') {
      this._status = 'stopping';
      getLogger(this.id).debug('Stopping...');
      if (typeof this.stopCallback === 'function') {
        await this.stopCallback(this.executionContext, this.options);
      }
      this.intervalTasks.forEach((task) => {
        clearInterval(task.intervalId);
      });
      this.cronTasks.forEach((task) => task.stop());
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
      this.webSocketProxies.forEach((wsProxy) => {
        if (this.webSocketServer != null) {
          this.webSocketServer.unregister(wsProxy);
        }
      });
      this._status = 'stopped';
    }
  }

  useEndpoint(method: HttpMethod, path: string, ...handlers: RequestHandler[]): EndpointRegistration {
    const reg = new EndpointRegistration(method, path, handlers);
    this.endpoints.push(reg);
    if (this.router && this._status === 'started') {
      registerEndpoint(this.router, reg);
    }
    return reg;
  }

  useWebSocket(path: string, options: UseWebSocketOptions): WebSocketProxy {
    let socketRegistration = this.webSocketProxies.find((r) => r.path === path);
    if (!socketRegistration) {
      socketRegistration = new WebSocketProxy(path, options);
      this.webSocketProxies.push(socketRegistration);
    }
    return socketRegistration;
  }

  scheduleTask(repeat: string | number, task: () => void) {
    if (typeof task !== 'function') {
      throw new Error('Expect parameter task to be a function.');
    }
    if (typeof repeat === 'string') {
      const cronTask = schedule(repeat, task);
      this.cronTasks.push(cronTask);
    } else if (!isNaN(repeat)) {
      this.intervalTasks.push({ repeat, func: task });
    }
  }

  onStarted(handler: (context?: Service, options?: { [key: string]: any }) => void | Promise<any>) {
    this.startCallback = handler;
  }

  onStopping(handler: (context?: Service, options?: { [key: string]: any }) => void | Promise<any>) {
    this.stopCallback = handler;
  }
}
