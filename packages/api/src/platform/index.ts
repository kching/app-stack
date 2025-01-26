import { config } from './config';
import { Endpoint, initialise, Plugin, PluginInitialisationError } from './plugin';
import { flatten } from 'lodash';
import { getLogger } from './logger';
import { Server } from 'node:http';
import { WebSocketEndpoint } from './webSockets';
import { ChainedResourceResolver, PrismaResourceResolver, ResourceResolver } from './resources';
import { platformPrisma } from './prisma';

const startPlugins = async (platform: Platform, roots: string[], options: { [key: string]: any } = {}) => {
  const startedPlugins: Plugin[] = [];
  const coreInitialisations = await Promise.all(roots.map((coreRoot) => initialise(platform, coreRoot, options)));
  const plugins = flatten(coreInitialisations)
    .filter((r) => r.status === 'fulfilled')
    .filter((settledResult) => settledResult.status === 'fulfilled')
    .map((fulfilledResult) => (fulfilledResult as PromiseFulfilledResult<Plugin>).value)
    .filter((plugin) => plugin != null);
  for (const plugin of plugins) {
    try {
      const startedPlugin = await plugin.withServer(platform.server).start();
      if (startedPlugin) {
        startedPlugins.push(startedPlugin);
      }
    } catch (error) {
      if (error instanceof PluginInitialisationError) {
        const pluginStartError = error as PluginInitialisationError;
        getLogger().error(`Circular dependency for plugins detected: ${pluginStartError.dependencyChain.join(' -> ')}`);
      }
      console.error(error);
      throw error;
    }
  }
  return startedPlugins;
};

const platformResourceResolver = new PrismaResourceResolver(platformPrisma);

export type AppServer = {
  registerEndpoint: (endpoint: Endpoint) => void;
  unregisterEndpoint: (endpoint: Endpoint) => void;
  registerWebSocket: (wsEndpoint: WebSocketEndpoint) => void;
  unregisterWebSocket: (wsEndpoint: WebSocketEndpoint) => void;

  start: (apiRoot: string, port?: number, callBack?: (server: Server) => void) => void | Promise<void>;
  stop: (sig: 'SIGINT' | 'SIGQUIT' | 'SIGTERM') => Promise<'SIGINT' | 'SIGQUIT' | 'SIGTERM'>;
};

export class Platform {
  private _plugins: { [id: string]: Plugin } = {};
  private _apiRoot = config.app.apiRoot;
  private _extensionRoots: string[] = config.app.extensionRoots;
  private _onShutdown?: () => Promise<void> | void;

  private _resourceResolver: ResourceResolver = platformResourceResolver;
  readonly server: AppServer;

  constructor(server: AppServer) {
    this.server = server;
  }

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
    getLogger().info(
      `${services.length} platform ${services.length < 2 ? 'service' : 'services'} and ` +
        `${extensions.length} extension ${extensions.length < 2 ? 'service' : 'services'} started`
    );
    this.server.start(this._apiRoot, port, callBack);

    const handleTermination = (sig: 'SIGINT' | 'SIGQUIT' | 'SIGTERM') => {
      const httpServerShutdown = this.server.stop(sig);
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

export default Platform;
