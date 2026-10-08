import { describe, expect, it } from 'vitest';
import { crc32, pcmReport, triggerReport } from './dualsense-protocol';

describe('DualSense reports', () => {
  it('uses the standard reflected CRC32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('places the Bluetooth PCM stream after its control packet', () => {
    const samples = Uint8Array.from({ length: 64 }, (_, index) => index);
    const report = pcmReport(257, samples);
    expect(report.length).toBe(141);
    expect([...report.slice(0, 12)]).toEqual([0, 0x91, 7, 0xfe, 0, 0, 0, 0, 0xff, 1, 0x92, 64]);
    expect(report.slice(12, 76)).toEqual(samples);
    expect(report.slice(76, -4).every((byte) => byte === 0)).toBe(true);
    const covered = new Uint8Array(139);
    covered.set([0xa2, 0x32]);
    covered.set(report.subarray(0, -4), 2);
    expect(new DataView(report.buffer).getUint32(137, true)).toBe(crc32(covered));
    expect(() => pcmReport(0, new Uint8Array(63))).toThrow();
  });

  it('enables only trigger effects and releases both on stop', () => {
    for (const bluetooth of [false, true]) {
      const offset = bluetooth ? 2 : 0;
      const report = triggerReport(bluetooth, 17, 0.5);
      expect(report.length).toBe(bluetooth ? 77 : 47);
      expect(report[offset]).toBe(0x0c);
      for (const start of [offset + 10, offset + 21]) {
        expect([...report.slice(start, start + 3)]).toEqual([1, 48, 80]);
        expect(triggerReport(bluetooth, 0, 0)[start]).toBe(5);
      }
      if (bluetooth) expect([...report.slice(0, 2)]).toEqual([0x10, 0x10]);
    }
  });
});
