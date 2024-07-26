import platform from './platform';

platform.start().then((platform) => {
  platform.onShutdown(() => {
    console.log('Application terminated');
  });
});
