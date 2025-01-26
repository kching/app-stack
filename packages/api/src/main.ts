import Platform from './platform';
import { server as expressServer } from './platform/servers/express';
import { getLogger } from './platform/logger';

const start = Date.now();

new Platform(expressServer)
  .start(async () => {
    const finished = Date.now();
    getLogger().info(`Application started in ${finished - start}ms`);
  })
  .then((platform) => {
    platform.onShutdown(() => {
      console.log('Application terminated');
    });
  });
