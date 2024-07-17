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
import auth, { jwt } from './userManagement/auth';
import health from './health';

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
  private _extensions: string[] = config.app.extensions;
  private _onShutdown?: () => void | null;

  apiRoot(root: string): Platform {
    this._apiRoot = root;
    return this;
  }
  staticRoot(root: string): Platform {
    this._staticRoot = root;
    return this;
  }
  extensions(extensions: string[]): Platform {
    this._extensions = extensions;
    return this;
  }

  private readonly services = [new Plugin('health', health), new Plugin('auth', auth)];
  async start(port?: number) {
    try {
      await Promise.all(this.services.map((service) => service.start()));
    } catch (error) {
      getLogger().error('Failed to initialize platform service', error);
      process.exit(1);
    }

    const result = await Promise.all(this._extensions.map((extensionRoot) => initialise(extensionRoot)));
    const plugins = flatten(result)
      .filter((r) => r.status === 'fulfilled')
      .filter((settledResult) => settledResult.status === 'fulfilled')
      .map((fulfilledResult) => (fulfilledResult as PromiseFulfilledResult<Plugin>).value)
      .filter((plugin) => plugin != null);
    await Promise.allSettled(
      plugins.map((plugin) => {
        plugin.withRouter(router).withWebSocketRouter(wsRouter).start();
      })
    );
    plugins.forEach((plugin) => {
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
    process.on('SIGINT', () => {
      httpServer.close(this._onShutdown);
    });
    return this;
  }

  onShutdown(callback: () => void) {
    this._onShutdown = callback;
  }
}

export default new Platform();
