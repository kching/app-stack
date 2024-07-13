import path from 'path';
import {RequestHandler, Router} from 'express';
import {getLogger} from './logger';
import {scanForFiles} from './fileUtils';
import {WebSocketHandler, WebSocketRouter} from './wsRouter';


export type HttpMethod = 'all' | 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

type EndpointRegistration = {
  method: HttpMethod;
  path: string;
  handlers: RequestHandler[];
  public?: boolean;
};

type WebSocketEndpointRegistration = {
  path: string;
  handler: WebSocketHandler;
};

type PluginStatus = 'created' | 'starting' | 'started' | 'stopping' | 'stopped';

type PluginFunction = (this: Plugin, options? : {[key: string]: any}) => (Promise<void> | void);

const logger = getLogger('Plugin');

const registerEndpoint = (router: Router, method: HttpMethod, path: string, ...handlers: RequestHandler[]) => {
  const func = (router as { [key: string]: any })[method.toLowerCase()];
  if (typeof func === 'function') {
    logger.debug(`Registering endpoint ${method.toUpperCase()} ${path}`);
    func.call(router, path, ...handlers);
  }
};

export const initialise = async (pluginLocation: string, options: {[key: string]: any} = {}) => {
  const pluginFiles = await scanForFiles(pluginLocation);
  return Promise.allSettled(
    pluginFiles.map(async (pluginPath) => {
      const extension = pluginPath.lastIndexOf('.');
      const id = extension > -1 ? pluginPath.slice(0, extension) : pluginPath;
      const module = await import(path.relative(__dirname, pluginPath));
      return new Plugin(id, module.default, options);
    })
  );
};

export class Plugin {

  private readonly _id;
  private readonly endpoints: EndpointRegistration[] = []
  private readonly webSocketEndpoints: WebSocketEndpointRegistration[] = [];
  private readonly options: { [key: string]: any } = {};
  private readonly init : Promise<string>;
  private _status: PluginStatus = 'created';
  private router?: Router;
  private wsRouter?: WebSocketRouter;
  private startCallback?: (context: Plugin , options: {[key:string]: any}) => Promise<void>;
  private stopCallback?: (context: Plugin, options: {[key:string]: any}) => Promise<void>;

  constructor(id: string, func: PluginFunction, options: {[key: string]: any} = {}) {
    this._id = id;
    this.options = options;

    const returnValue = func.call<Plugin,{[key:string]:any}[],Promise<void>|void>(this, options)
    this.init = new Promise((resolve, reject) => {
      resolve(func.call(this, options));
    }).then(() => 'ready')
      .catch(error => {
        logger.warn(`Failed to load plugin ${id}`, error);
        return 'failed'
      });
  }

  get id() : string {
    return this._id;
  }
  get status() : PluginStatus {
    return this._status;
  }

  useEndpoint(method: HttpMethod, path: string, ...handlers: RequestHandler[]) {
    this.endpoints.push({
      method, path, handlers
    });
    if (this.router && this._status === 'started') {
      registerEndpoint(this.router, method, path, ...handlers);
    }
  }

  useWebsocket(path: string, handler: WebSocketHandler) {
    this.webSocketEndpoints.push({path, handler});
    if (this.wsRouter && this._status === 'started') {
      this.wsRouter.registerEndpoint(path, handler);
    }
  }

  onStart(handler : (context: Plugin) => Promise<void>) {
    this.startCallback = handler;
  }

  onStop(handler: (context: Plugin) => Promise<void>) {
    this.stopCallback = handler;
  }

  async start(router?: Router, wsRouter?: WebSocketRouter) {
    this.router = router;
    this.wsRouter = wsRouter;
    const init = await this.init;
    if(init === 'ready' && (this.status === 'created' || this.status === 'stopped')) {
      this._status = 'starting';
      if (router) {
        this.endpoints.forEach(({method, path, handlers}) => {
          registerEndpoint(router, method, path, ...handlers);
        });
      }
      if(wsRouter) {
        this.webSocketEndpoints.forEach(({path, handler}) => {
          wsRouter.registerEndpoint(path, handler);
        })
      }
      if(typeof this.startCallback === 'function') {
        await this.startCallback(this, this.options);
      }
      this._status = 'started'
    }
  }

  async stop() {
    if (this._status === 'started') {
      this._status = 'stopping';
      if(typeof this.stopCallback === 'function') {
        await this.stopCallback(this, this.options);
      }
      this.endpoints.map(endpoint => endpoint.path).forEach(path => {
        if(this.router && this.router.stack) {
          let paths = this.router.stack.map((layer) => layer.route?.path);
          while(paths.indexOf(path) > -1) {
            this.router.stack.splice(paths.indexOf(path));
            paths = this.router.stack.map((layer) => layer.route?.path);
          }
        }
      });
      if(this.wsRouter) {
        this.webSocketEndpoints.forEach(endpoint => {
          // this.wsRouter.unregisterEndpoint(...)
        });
      }
      this._status = 'stopped';
    }
  }
}
