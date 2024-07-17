import { ExecutionContext } from '../platform/plugin';

export default function (this: ExecutionContext) {
  this.useEndpoint('get', '/example', (req, res) => {
    res.status(200).json({
      status: 'ok',
    });
  }).withAuthentication(null);
}
