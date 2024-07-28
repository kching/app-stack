import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage, Server } from 'http';
import UrlPattern from 'url-pattern';
import { getLogger } from './logger';

type WebSocketOptions = {
  userUid?: string;
  req?: IncomingMessage;
  params?: { [key: string]: string };
  ws?: WebSocket;
};

type ConnectionHandler = (ws: WebSocket, options?: WebSocketOptions) => void;
type DisconnectionHandler = (ws: WebSocket, options?: WebSocketOptions) => void;
type MessageHandler = (message: string | object, options?: WebSocketOptions) => void;
export type MessageDecoder = (event: WebSocket.MessageEvent) => object;
export type MessageEncoder = (message: object) => string | ArrayBuffer;
export type UseWebSocketOptions = {
  encoder?: MessageEncoder;
  decoder?: MessageDecoder;
};

const getUser = (request: IncomingMessage) => {
  return '';
};

const jsonDecoder = (event: WebSocket.MessageEvent) => {
  return {};
};

const jsonEncoder = (message: object) => JSON.stringify(message);

export class WebSocketProxy {
  readonly path;
  readonly decode: MessageDecoder = jsonDecoder;
  readonly encode: MessageEncoder = jsonEncoder;
  readonly clientSockets: WebSocket[] = [];
  readonly socketByUserUid: WeakMap<{ userUid: string }, WebSocket[]> = new WeakMap<{ userUid: string }, WebSocket[]>();

  readonly _onConnect: ConnectionHandler[] = [];
  readonly _onDisconnect: DisconnectionHandler[] = [];
  readonly _onMessage: MessageHandler[] = [];
  readonly _onError: ((event: WebSocket.ErrorEvent) => void)[] = [];

  constructor(
    path: string,
    options: {
      encoder?: MessageEncoder;
      decoder?: MessageDecoder;
    }
  ) {
    this.path = path;
    const { encoder, decoder } = options;
    if (decoder != null) {
      this.decode = decoder;
    }
    if (encoder != null) {
      this.encode = encoder;
    }
  }

  onConnect(handler: ConnectionHandler) {
    this._onConnect.push(handler);
    return this;
  }
  onDisconnect(handler: DisconnectionHandler) {
    this._onDisconnect.push(handler);
    return this;
  }
  onMessage(handler: MessageHandler) {
    this._onMessage.push(handler);
    return this;
  }
  onError(handler: (event: WebSocket.ErrorEvent) => void) {
    this._onError.push(handler);
    return this;
  }
  async send(message: object, ...userId: string[]) {
    let audience: WebSocket[] = [];
    if (userId === undefined) {
      audience = this.clientSockets;
    } else {
      userId.forEach((userUid) => {
        const userSocket = this.socketByUserUid.get({ userUid });
        if (userSocket) {
          audience.concat(userSocket);
        }
      });
    }

    const payload = this.encode(message);
    return Promise.allSettled(
      audience.map((socket) => {
        return new Promise((resolve, reject) => {
          try {
            socket.send(payload, () => resolve(null));
          } catch (error) {
            reject(error);
          }
        });
      })
    );
  }
  close() {
    this.clientSockets.map((ws) => ws.terminate());
  }
}

export class WSServer {
  private readonly wsProxies: WebSocketProxy[] = [];

  constructor(httpServer: Server) {
    const webSocketServer = new WebSocketServer({ server: httpServer });
    webSocketServer.on('connection', (ws, request) => {
      if (request.url) {
        this.wsProxies.forEach((registration) => {
          const pattern = new UrlPattern(registration.path);
          const params = pattern.match(request.url as string);
          if (params) {
            const userUid = getUser(request);
            const handlerOptions = { params, req: request, userUid, ws };
            registration.clientSockets.push(ws);
            let userSockets = registration.socketByUserUid.get({ userUid });
            if (!userSockets) {
              userSockets = [];
              registration.socketByUserUid.set({ userUid }, userSockets);
            }
            userSockets.push(ws);
            registration._onConnect.forEach((handler) => {
              ws.onmessage = (event) => {
                const message = registration.decode(event);
                registration._onMessage.forEach((handler) => {
                  try {
                    handler(message, handlerOptions);
                  } catch (error) {
                    getLogger('webSocket').error((error as unknown as Error).stack);
                  }
                });
              };
              ws.onclose = () => {
                const userSockets = registration.socketByUserUid.get({ userUid });
                if (userSockets) {
                  const index = userSockets.indexOf(ws);
                  if (index > -1) {
                    userSockets.splice(index, 1);
                  }
                  if (userSockets.length === 0) {
                    registration.socketByUserUid.delete({ userUid });
                  }
                }
                const index = registration.clientSockets.indexOf(ws);
                if (index > -1) {
                  registration.clientSockets.splice(index, 1);
                }
                registration._onDisconnect.forEach((handler) => {
                  try {
                    handler(ws, handlerOptions);
                  } catch (error) {
                    getLogger('webSocket').error((error as unknown as Error).stack);
                  }
                });
              };
              ws.onerror = (event) => {
                registration._onError.forEach((handler) => {
                  try {
                    handler(event);
                  } catch (error) {
                    getLogger('webSocket').error((error as unknown as Error).stack);
                  }
                });
              };
              try {
                handler(ws, handlerOptions);
              } catch (error) {
                getLogger('webSocket').error((error as unknown as Error).stack);
              }
            });
          }
        });
      }
    });
  }

  register(wxProxy: WebSocketProxy) {
    const index = this.wsProxies.indexOf(wxProxy);
    if (index === -1) {
      this.wsProxies.push(wxProxy);
    }
  }

  unregister(wsProxy: WebSocketProxy) {
    const index = this.wsProxies.indexOf(wsProxy);
    if (index > -1) {
      this.wsProxies.splice(index, 1);
      wsProxy.close();
    }
  }
}

export const createWebSocketServer = (httpServer: Server) => new WSServer(httpServer);
