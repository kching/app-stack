import { Service } from '../plugin';
import pkg from '../../../package.json';

const getVersion = () => {
  return pkg.version;
};

export function init(this: Service) {
  const version = getVersion();
  this.logger.info(`Server version ${version}`);

  this.useEndpoint('get', '/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      version,
    });
  });
}
