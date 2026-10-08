import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DualSense } from './dualsense';

const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};

function environment() {
  const device = Object.assign(new EventTarget(), {
    vendorId: 0x054c,
    productId: 0x0ce6,
    opened: false,
    collections: [{ outputReports: [0x31, 0x32].map((reportId) => ({ reportId })), children: [] }],
    open: vi.fn(async () => {
      device.opened = true;
    }),
    close: vi.fn(async () => {
      device.opened = false;
    }),
    sendReport: vi.fn(async (_id: number, _data: Uint8Array) => undefined),
  });
  const hid = Object.assign(new EventTarget(), {
    getDevices: vi.fn(async () => [device]),
    requestDevice: vi.fn(async () => [device]),
  });
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true });
  vi.stubGlobal('navigator', { hid });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  return { device, hid, window, document };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DualSense lifecycle', () => {
  it('opens an authorised controller without showing the permission chooser', async () => {
    const { hid, device } = environment();
    const controller = new DualSense();
    await flush();
    expect(controller.connected).toBe(true);
    expect(controller.pcmAvailable).toBe(true);
    expect(device.open).toHaveBeenCalledTimes(1);
    expect(hid.requestDevice).not.toHaveBeenCalled();
  });

  it('opens the chooser synchronously from an explicit connect action', async () => {
    const { hid } = environment();
    hid.getDevices.mockResolvedValue([]);
    const controller = new DualSense();
    const connecting = controller.connect();
    expect(hid.requestDevice).toHaveBeenCalledTimes(1);
    expect(await connecting).toBe(true);
  });

  it('notifies a new connection once without re-enabling options on status changes', async () => {
    environment();
    const controller = new DualSense();
    const connected = vi.fn();
    controller.onConnect = connected;
    await flush();
    expect(connected).toHaveBeenCalledTimes(1);
    controller.configure(false, 0);
    controller.engine();
    await controller.connect();
    expect(connected).toHaveBeenCalledTimes(1);
  });

  it('streams audio and releases both triggers on focus loss', async () => {
    const { device, window } = environment();
    const controller = new DualSense();
    await flush();
    controller.configure(true, 2);
    controller.engine();
    controller.pcm(new Uint8Array(64).fill(16));
    await flush();
    expect(device.sendReport.mock.calls.some(([id, data]) => id === 0x32 && data[12] === 16)).toBe(true);
    window.dispatchEvent(new Event('blur'));
    await flush();
    const triggers = device.sendReport.mock.calls.filter(([id]) => id === 0x31);
    expect(triggers.at(-1)?.[1][12]).toBe(5);
    expect(triggers.at(-1)?.[1][23]).toBe(5);
    const writes = device.sendReport.mock.calls.length;
    controller.pcm(new Uint8Array(64).fill(64));
    await vi.advanceTimersByTimeAsync(100);
    expect(device.sendReport.mock.calls.length).toBe(writes);
  });

  it('preserves controller input when haptic writes fail', async () => {
    const { device } = environment();
    const controller = new DualSense();
    await flush();
    device.sendReport.mockRejectedValue(new Error('Disconnected'));
    controller.engine();
    controller.pcm(new Uint8Array(64));
    await flush();
    expect(controller.connected).toBe(true);
    expect(controller.error).toBe(true);
    expect(controller.pcmAvailable).toBe(false);
    expect(device.close).not.toHaveBeenCalled();
    const bytes = new Uint8Array([128, 128, 128, 128, 8, 0, 0, 0, 255]);
    device.dispatchEvent(Object.assign(new Event('inputreport'), { reportId: 1, data: new DataView(bytes.buffer) }));
    expect(controller.gamepad?.buttons[7]?.value).toBe(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(controller.gamepad).toBeNull();
  });

  it('reconnects after an authorised controller returns', async () => {
    const { hid, device } = environment();
    const controller = new DualSense();
    await flush();
    hid.getDevices.mockResolvedValue([]);
    hid.dispatchEvent(Object.assign(new Event('disconnect'), { device }));
    await flush();
    expect(controller.connected).toBe(false);
    hid.getDevices.mockResolvedValue([device]);
    hid.dispatchEvent(new Event('connect'));
    await flush();
    expect(controller.connected).toBe(true);
    expect(hid.requestDevice).not.toHaveBeenCalled();
  });

  it('recovers haptics from a transient Bluetooth write failure without closing input', async () => {
    const { device } = environment();
    const controller = new DualSense();
    await flush();
    device.sendReport.mockRejectedValueOnce(new Error('Temporary radio failure'));
    controller.configure(true, 2);
    controller.engine();
    controller.pcm(new Uint8Array(64).fill(32));
    await flush();
    expect(controller.error).toBe(true);
    await vi.advanceTimersByTimeAsync(1001);
    controller.engine();
    controller.pcm(new Uint8Array(64).fill(32));
    await flush();
    expect(controller.error).toBe(false);
    expect(controller.pcmAvailable).toBe(true);
    expect(device.sendReport.mock.calls.at(-1)?.[0]).toBe(0x32);
    expect(device.close).not.toHaveBeenCalled();
  });

  it('bounds recovery attempts and never retries haptics in the background', async () => {
    const { device, document } = environment();
    const controller = new DualSense();
    await flush();
    device.sendReport.mockRejectedValue(new Error('Unavailable'));
    controller.configure(true, 2);
    controller.engine();
    await flush();
    const initial = device.sendReport.mock.calls.length;
    document.hidden = true;
    await vi.advanceTimersByTimeAsync(5000);
    controller.engine();
    await flush();
    expect(device.sendReport.mock.calls.length).toBe(initial);
    document.hidden = false;
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      controller.engine();
      await flush();
    }
    expect(device.sendReport.mock.calls.length - initial).toBe(3);
    expect(controller.error).toBe(true);
    expect(controller.connected).toBe(true);
  });

  it('keeps the game usable when WebHID is unavailable', async () => {
    environment();
    vi.stubGlobal('navigator', {});
    const controller = new DualSense();
    expect(controller.supported).toBe(false);
    expect(await controller.connect()).toBe(false);
    controller.engine();
    await controller.stop();
  });
});
