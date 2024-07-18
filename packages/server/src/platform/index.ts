import express, { json, static as staticResource } from 'express';
import { config } from './config';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { WebSocketRouter } from './wsRouter';
import cookieParser from 'cookie-parser';
import { initialise, Plugin, PluginInitialisationError } from './plugin';
import { flatten } from 'lodash';
import { getLogger } from './logger';
import passport from 'passport';
import { jwt } from './services/userManagement/auth';

const app = express();
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({ server: httpServer });
const wsRouter = new WebSocketRouter(webSocketServer);

const router = express.Router({});
router.use(json());
router.use(cookieParser());
router.use(passport.initialize());
passport.use(jwt());

const startPlugins = async (roots: string[], options: { [key: string]: any } = {}) => {
  const coreInitialisations = await Promise.all(roots.map((coreRoot) => initialise(coreRoot, options)));
  const plugins = flatten(coreInitialisations)
    .filter((r) => r.status === 'fulfilled')
    .filter((settledResult) => settledResult.status === 'fulfilled')
    .map((fulfilledResult) => (fulfilledResult as PromiseFulfilledResult<Plugin>).value)
    .filter((plugin) => plugin != null);
  for (const plugin of plugins) {
    try {
      await plugin.withRouter(router).withWebSocketRouter(wsRouter).start();
    } catch (error) {
      const pluginStartError = error as PluginInitialisationError;

      getLogger().error(`Circular dependency for plugins detected: ${pluginStartError.dependencyChain.join(' -> ')}`);
      process.exit(1);
    }
  }
  return plugins;
};

class Platform {
  private _plugins: { [id: string]: Plugin } = {};
  private _apiRoot = config.app.apiRoot;
  private _staticRoot = config.app.staticRoot;
  private _extensionRoots: string[] = config.app.extensionRoots;
  private _onShutdown?: () => Promise<void> | void;

  apiRoot(root: string): Platform {
    this._apiRoot = root;
    return this;
  }
  staticRoot(root: string): Platform {
    this._staticRoot = root;
    return this;
  }
  extensionRoots(extensions: string[]): Platform {
    this._extensionRoots = extensions;
    return this;
  }

  private readonly serviceRoots = ['./src/platform/services'];

  async start(port?: number) {
    let services: Plugin[] = [];
    try {
      services = await startPlugins(this.serviceRoots, { idPrefix: 'platform/' });
    } catch (error) {
      getLogger().error('Failed to initialize platform service', error);
      process.exit(1);
    }

    const extensions = await startPlugins(this._extensionRoots);
    extensions.forEach((plugin) => {
      this._plugins[plugin.id] = plugin;
    });
    const resolvedPort = port ?? config.app.port;

    app.use(json());
    app.use(cookieParser());
    app.use(staticResource(this._staticRoot));
    app.use(this._apiRoot, router);
    httpServer.listen(resolvedPort, () => {
      getLogger().info(`App server running on port ${resolvedPort}`);
    });

    const handleTermination = (sig: 'SIGINT' | 'SIGQUIT' | 'SIGTERM') => {
      const httpServerShutdown = new Promise((resolve) => {
        httpServer.close(() => resolve(sig));
      });
      httpServerShutdown
        .then(() => Promise.allSettled(extensions.map((p) => p.stop())))
        .then(() => Promise.allSettled(services.map((service) => service.stop())))
        .then(() => {
          if (typeof this._onShutdown === 'function') {
            return this._onShutdown();
          }
          return this;
        })
        .then(() => process.exit(0));
    };
    process.on('SIGINT', () => handleTermination('SIGINT'));
    process.on('SIGQUIT', () => handleTermination('SIGQUIT'));
    process.on('SIGTERM', () => handleTermination('SIGTERM'));

    return this;
  }

  onShutdown(callback: () => Promise<void> | void) {
    this._onShutdown = callback;
  }
}

export default new Platform();
