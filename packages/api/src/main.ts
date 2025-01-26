import platform from './platform';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './platform/config';
import { getLogger } from './platform/logger';

const start = Date.now();
if (config.app.proxy) {
  const proxy = createProxyMiddleware({
    target: config.app.proxy,
  });
  getLogger().info(`Proxying non-API traffic to ${config.app.proxy}`);
  platform.configure((app) => {
    app.use('/', (req, res, next) => {
      if (req.path.startsWith(config.app.apiRoot)) {
        next();
      } else {
        proxy(req, res, next);
      }
    });
  });
}

platform
  .start(async () => {
    const finished = Date.now();
    getLogger().info(`Application started in ${finished - start}ms`);
  })
  .then((platform) => {
    platform.onShutdown(() => {
      console.log('Application terminated');
    });
  });
