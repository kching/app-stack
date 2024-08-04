import { Service, Plugin } from './plugin';
import { Platform } from './index';

describe('plugin', () => {
  it('should call plugin initialisation function', async () => {
    const pluginFn = jest.fn();
    const plugin = new Plugin('test', pluginFn, {});
    expect(plugin.id).toBe('test');
    expect(plugin.status).toBe('created');
    expect(pluginFn).toHaveBeenCalled();
  });

  it('should start', async () => {
    const startFn = jest.fn();
    const pluginFn = function (this: Service) {
      this.onStart(startFn);
    };
    const plugin = new Plugin('test', pluginFn, {});
    await plugin.start();
    expect(plugin.status).toBe('started');
    expect(startFn).toHaveBeenCalled();
  });

  it('should stop', async () => {
    const stopFn = jest.fn();
    const pluginFn = function (this: Service) {
      this.onStop(stopFn);
    };
    const plugin = new Plugin('test', pluginFn, {});
    await plugin.start();
    await plugin.stop();
    expect(plugin.status).toBe('stopped');
    expect(stopFn).toHaveBeenCalled();
  });
});
