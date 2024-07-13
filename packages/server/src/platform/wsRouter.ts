import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import UrlPattern from 'url-pattern';

export type Request = IncomingMessage & { params?: any };

export type WebSocketHandler = (ws: WebSocket, req: Request) => void;

export class WebSocketRouter {
  private handlers: {
    [key: string]: WebSocketHandler[];
  } = {};

  constructor(webSocketServer: WebSocketServer) {
    webSocketServer.on('connection', (ws, request) => {
      if (request.url) {
        Object.keys(this.handlers).forEach((path) => {
          const pattern = new UrlPattern(path);
          const params = pattern.match(request.url as string);
          if (params) {
            this.handlers[path].forEach((handler) =>
              handler(ws, Object.assign(request, { params }))
            );
          }
        });
      }
    });
  }

  registerEndpoint(path: string, handler: WebSocketHandler) {
    if (!this.handlers[path]) {
      this.handlers[path] = [];
    }
    this.handlers[path].push(handler);
  }
}

export default (webSocketServer: WebSocketServer) =>
  new WebSocketRouter(webSocketServer);
