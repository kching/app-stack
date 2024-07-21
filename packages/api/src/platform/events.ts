import {EventEmitter} from 'events';

export type EventMeta = { [key: string]: any };

export type EventHandler<T> = (payload: T, meta: EventMeta) => void;

const eventEmitter = new EventEmitter();

export const subscribe = (topic: string, handler: EventHandler<any>) => {
  if (topic && typeof handler === 'function') {
    eventEmitter.addListener(topic, handler);
  }
};

export const unsubscribe = (topic: string, handler: EventHandler<any>) => {
  if (topic && typeof handler === 'function') {
    eventEmitter.removeListener(topic, handler);
  }
};

export const publish = (topic: string, payload: any, meta = {}) => {
  eventEmitter.emit(topic, payload, meta);
};
