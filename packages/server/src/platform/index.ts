import express, { json, static as staticResource } from 'express';
import { config } from './config';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { WebSocketRouter } from './wsRouter';
import cookieParser from 'cookie-parser';
import { initialise, Plugin } from './plugin';
import { flatten } from 'lodash';
import { getLogger } from './logger';
import passport from 'passport';
import { init as userGroupService } from './userManagement/userGroups';
import { init as authService, jwt } from './userManagement/auth';
import { init as healthService } from './health';

const app = express();
const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({ server: httpServer });
const wsRouter = new WebSocketRouter(webSocketServer);

const router = express.Router({});
router.use(json());
router.use(cookieParser());
router.use(passport.initialize());
passport.use(jwt());

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

  private readonly corePlugins = [
    new Plugin('health', healthService),
    new Plugin('auth', authService),
    new Plugin('userGroups', userGroupService),
  ];

  async start(port?: number) {
    try {
      await Promise.all(
        this.corePlugins.map((service) => service.withRouter(router).withWebSocketRouter(wsRouter).start())
      );
    } catch (error) {
      getLogger().error('Failed to initialize platform service', error);
      process.exit(1);
    }

    const result = await Promise.all(this._extensionRoots.map((extensionRoot) => initialise(extensionRoot)));
    const extensions = flatten(result)
      .filter((r) => r.status === 'fulfilled')
      .filter((settledResult) => settledResult.status === 'fulfilled')
      .map((fulfilledResult) => (fulfilledResult as PromiseFulfilledResult<Plugin>).value)
      .filter((plugin) => plugin != null);
    await Promise.allSettled(
      extensions.map((plugin) => {
        plugin.withRouter(router).withWebSocketRouter(wsRouter).start();
      })
    );
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
        .then(() => Promise.allSettled(this.corePlugins.map((service) => service.stop())))
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
