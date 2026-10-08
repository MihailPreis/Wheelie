import { decodeDualSenseInput } from './dualsense-input';
import { pcmReport, triggerReport } from './dualsense-protocol';
import type { ControllerPad } from './gamepads';

interface HidCollection {
  outputReports: { reportId: number }[];
  children: HidCollection[];
}
interface HidDevice extends EventTarget {
  vendorId: number;
  productId: number;
  opened: boolean;
  collections: HidCollection[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(id: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
}
interface Hid extends EventTarget {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: { filters: { vendorId: number; productId: number }[] }): Promise<HidDevice[]>;
}
const FILTERS = [0x0ce6, 0x0df2].map((productId) => ({ vendorId: 0x054c, productId }));
const sony = (device: HidDevice) =>
  FILTERS.some((filter) => filter.vendorId === device.vendorId && filter.productId === device.productId);
const reports = (collections: HidCollection[]): number[] =>
  collections.flatMap((collection) => [
    ...collection.outputReports.map((report) => report.reportId),
    ...reports(collection.children),
  ]);

/** Owns the output stream. Reconnect uses existing permission; the chooser only opens on a click. */
export class DualSense {
  private readonly hid = (navigator as Navigator & { hid?: Hid }).hid;
  private device: HidDevice | null = null;
  private bluetooth = false;
  private hasPcm = false;
  private connecting: Promise<boolean> | null = null;
  private sequence = 0;
  private counter = 0;
  private queue: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private active = false;
  private enabled = true;
  private resistance = 0;
  private applied = -1;
  private deadline = 0;
  private pendingWrites = 0;
  private directInput: ControllerPad | null = null;
  private inputTime = 0;
  private outputFailed = false;
  private retryAfter = 0;
  private outputRetries = 0;
  onChange: (() => void) | null = null;
  /** A newly opened controller, separate from status and output-error notifications. */
  onConnect: (() => void) | null = null;
  error = false;

  constructor() {
    this.hid?.addEventListener('connect', () => void this.reconnect());
    this.hid?.addEventListener('disconnect', (event) => {
      if ((event as Event & { device: HidDevice }).device !== this.device) return;
      this.device?.removeEventListener('inputreport', this.readInput);
      this.device = null;
      this.directInput = null;
      this.clearPcm();
      this.applied = -1;
      this.onChange?.();
      void this.reconnect();
    });
    window.addEventListener('blur', () => this.stop());
    window.addEventListener('pagehide', () => this.stop());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else void this.reconnect();
    });
    void this.reconnect();
  }

  get supported(): boolean {
    return this.hid !== undefined;
  }
  get connected(): boolean {
    return this.device !== null;
  }
  get pcmAvailable(): boolean {
    return this.connected && this.bluetooth && this.hasPcm && !this.outputFailed;
  }

  get gamepad(): ControllerPad | null {
    return this.connected && performance.now() - this.inputTime < 1000 ? this.directInput : null;
  }

  private readonly readInput = (event: Event): void => {
    const report = event as Event & { reportId: number; data: DataView };
    const input = decodeDualSenseInput(report.reportId, report.data);
    if (!input) return;
    this.directInput = input;
    this.inputTime = performance.now();
  };

  private reconnect(): Promise<boolean> {
    if (!this.hid || this.device) return Promise.resolve(this.connected);
    this.connecting ??= this.hid
      .getDevices()
      .then((devices) => this.open(devices.find(sony)))
      .catch(() => false)
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  /** Invoke directly from a user gesture; awaiting getDevices first can lose that gesture. */
  async connect(): Promise<boolean> {
    if (!this.hid) return false;
    try {
      const chosen = await this.hid.requestDevice({ filters: FILTERS });
      if (!chosen[0]) return false;
      await this.connecting;
      return await this.open(chosen[0]);
    } catch {
      this.error = true;
      this.onChange?.();
      return false;
    }
  }

  private async open(device: HidDevice | undefined): Promise<boolean> {
    if (!device) return false;
    if (this.device === device) {
      this.outputFailed = this.error = false;
      this.outputRetries = 0;
      this.applied = -1;
      this.applyTriggers();
      this.onChange?.();
      return true;
    }
    if (this.device) {
      await this.stop();
      this.device.removeEventListener('inputreport', this.readInput);
      await this.device.close();
    }
    if (!device.opened) await device.open();
    const ids = reports(device.collections);
    if (!ids.includes(0x31) && !ids.includes(0x02)) {
      await device.close();
      return false;
    }
    this.device = device;
    this.directInput = null;
    this.outputFailed = false;
    this.outputRetries = 0;
    device.addEventListener('inputreport', this.readInput);
    this.bluetooth = ids.includes(0x31);
    this.hasPcm = ids.includes(0x32);
    this.error = false;
    this.applied = -1;
    this.applyTriggers();
    this.onConnect?.();
    this.onChange?.();
    return true;
  }

  configure(haptics: boolean, resistance: number): void {
    this.enabled = haptics;
    this.resistance = Math.max(0, Math.min(3, resistance)) / 3;
    if (!haptics) this.clearPcm();
    this.applyTriggers();
  }

  engine(): void {
    // A background or unfocused page must never restart feedback.
    this.active = !document.hidden && document.hasFocus();
    // A brief Bluetooth write failure must not permanently silence the engine.
    // Retry only while riding in the foreground, and stop after three failed attempts.
    if (this.active && this.outputFailed && this.outputRetries < 3 && performance.now() >= this.retryAfter) {
      this.outputRetries++;
      this.outputFailed = this.error = false;
      this.applied = -1;
      this.onChange?.();
    }
    this.applyTriggers();
  }

  stop(): Promise<void> {
    const wasActive = this.active;
    this.active = false;
    if (wasActive || this.timer !== null) this.clearPcm();
    this.applyTriggers();
    return this.chain;
  }

  private applyTriggers(): void {
    if (!this.device || this.outputFailed) return;
    const strength = this.active ? this.resistance : 0;
    if (strength === this.applied) return;
    this.applied = strength;
    this.send(this.bluetooth ? 0x31 : 0x02, triggerReport(this.bluetooth, this.sequence++, strength));
  }

  /** Samples of the actual engine sound, tapped after its filter and volume envelope. */
  pcm(samples: Uint8Array): void {
    if (!this.active || !this.enabled || !this.pcmAvailable) return;
    this.queue.push(samples);
    if (this.queue.length > 6) this.queue.shift(); // Never accumulate more than 64 ms of delay.
    if (this.timer === null) {
      this.deadline = performance.now();
      this.pump();
    }
  }

  private pump(): void {
    this.timer = null;
    const samples = this.queue.shift();
    if (!samples || !this.active || !this.enabled || !this.pcmAvailable) return;
    this.send(0x32, pcmReport(this.counter++, samples), true);
    const now = performance.now();
    this.deadline = Math.max(this.deadline + 32000 / 3000, now);
    this.timer = setTimeout(() => this.pump(), Math.max(0, this.deadline - now));
  }

  private clearPcm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    if (this.pcmAvailable) this.send(0x32, pcmReport(this.counter++, new Uint8Array(64)));
  }

  private send(id: number, data: Uint8Array<ArrayBuffer>, discardIfBusy = false): void {
    const device = this.device;
    if (!device || this.outputFailed) return;
    if (discardIfBusy && this.pendingWrites >= 2) return;
    this.pendingWrites++;
    // Bound pending HID writes: a slow radio must not queue stale engine audio.
    this.chain = this.chain
      .then(async () => {
        if (this.device !== device || this.outputFailed) return;
        await device.sendReport(id, data);
        if (id === 0x32 && discardIfBusy) this.outputRetries = 0;
      })
      .catch(() => {
        if (this.device !== device) return;
        this.outputFailed = true;
        this.error = true;
        this.retryAfter = performance.now() + 1000 * (this.outputRetries + 1);
        this.clearPcm();
        // An output failure must never disconnect the rider's controls.
        this.onChange?.();
      })
      .finally(() => {
        this.pendingWrites--;
      });
  }
}
