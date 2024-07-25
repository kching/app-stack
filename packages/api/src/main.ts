import platform from './platform';
import notifications from './platform/services/notifications';
import { SendGridProvider } from './platform/services/notifications/email';
import { config } from './platform/config';

notifications.use('email', new SendGridProvider(config.app.templateRoot));

platform.start().then((platform) => {
  platform.onShutdown(() => {
    console.log('Application terminated');
  });
});
