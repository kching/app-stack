import express, { Express, json, static as staticResource } from 'express';
import { config } from './config';
import { createServer } from 'http';
import cookieParser from 'cookie-parser';
import { initialise, Plugin, PluginInitialisationError } from './plugin';
import { flatten } from 'lodash';
import { getLogger } from './logger';
import passport from 'passport';
import { jwt } from './services/userManagement/auth';
import { Server } from 'node:http';
import { createWebSocketServer } from './webSockets';
import { ChainedResourceResolver, PrismaResourceResolver, ResourceResolver } from './resources';
import { platformPrisma } from './prisma';
import { PrismaClient } from '@prisma/client';
import notifications, { NotificationProvider } from './services/notifications';

const app = express();
const httpServer = createServer(app);
const webSocketServer = createWebSocketServer(httpServer);

const router = express.Router({});
router.use(json());
router.use(cookieParser());
router.use(passport.initialize());
passport.use(jwt());

const startPlugins = async (platform: Platform, roots: string[], options: { [key: string]: any } = {}) => {
  const coreInitialisations = await Promise.all(roots.map((coreRoot) => initialise(platform, coreRoot, options)));
  const plugins = flatten(coreInitialisations)
    .filter((r) => r.status === 'fulfilled')
    .filter((settledResult) => settledResult.status === 'fulfilled')
    .map((fulfilledResult) => (fulfilledResult as PromiseFulfilledResult<Plugin>).value)
    .filter((plugin) => plugin != null);
  for (const plugin of plugins) {
    try {
      await plugin.withRouter(router).withWebSocket(webSocketServer).start();
    } catch (error) {
      if (error instanceof PluginInitialisationError) {
        const pluginStartError = error as PluginInitialisationError;
        getLogger().error(`Circular dependency for plugins detected: ${pluginStartError.dependencyChain.join(' -> ')}`);
      }
      console.error(error);
      process.exit(1);
    }
  }
  return plugins;
};

const platformResourceResolver = new PrismaResourceResolver(platformPrisma);

export class Platform {
  private _plugins: { [id: string]: Plugin } = {};
  private _apiRoot = config.app.apiRoot;
  private _extensionRoots: string[] = config.app.extensionRoots;
  private _onShutdown?: () => Promise<void> | void;

  private _resourceResolver: ResourceResolver = platformResourceResolver;

  apiRoot(root: string): Platform {
    this._apiRoot = root;
    return this;
  }

  extensionRoots(extensions: string[]): Platform {
    this._extensionRoots = extensions;
    return this;
  }

  resourceResolvers(...resourceResolvers: ResourceResolver[]): Platform {
    if (resourceResolvers && resourceResolvers.length > 0) {
      this._resourceResolver = new ChainedResourceResolver(...resourceResolvers, platformResourceResolver);
    }
    return this;
  }

  withNotificationProvider(channel: string, provider: NotificationProvider) {
    notifications.use(channel, provider);
    return this;
  }

  configure(func: (app: Express) => void) {
    func(app);
    return this;
  }

  private readonly serviceRoots = ['./src/platform/services'];

  getResourceResolver() {
    return this._resourceResolver;
  }

  async start(callBack?: (httpServer: Server) => Promise<void>, port?: number) {
    let services: Plugin[] = [];
    try {
      services = await startPlugins(this, this.serviceRoots, { idPrefix: 'platform/' });
    } catch (error) {
      getLogger().error('Failed to initialize platform service');
      console.error(error);
      process.exit(1);
    }

    const extensions = await startPlugins(this, this._extensionRoots);
    extensions.forEach((plugin) => {
      this._plugins[plugin.id] = plugin;
    });
    const resolvedPort = port ?? config.app.port;

    app.use(json());
    app.use(cookieParser());
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

    if (typeof callBack === 'function') {
      await callBack(httpServer);
    }

    return this;
  }

  onShutdown(callback: () => Promise<void> | void) {
    this._onShutdown = callback;
  }
}

export default new Platform();
