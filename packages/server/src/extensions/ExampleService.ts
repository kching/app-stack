import { Service } from '../platform/plugin';

export function init(this: Service) {
  this.useEndpoint('get', '/example', (req, res) => {
    res.status(200).json({
      status: 'ok',
    });
  }).withAuthentication(null);
}
