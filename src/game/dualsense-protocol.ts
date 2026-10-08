/** DualSense HID wire format; report IDs are passed separately to WebHID. */
export function crc32(bytes: readonly number[] | Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checksum(id: number, data: Uint8Array): void {
  const covered = new Uint8Array(data.length - 2);
  covered.set([0xa2, id]);
  covered.set(data.subarray(0, -4), 2);
  new DataView(data.buffer).setUint32(data.length - 4, crc32(covered), true);
}

/** Resistance begins partway through travel, leaving the dead zone free. */
export function triggerReport(bluetooth: boolean, sequence: number, strength: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(bluetooth ? 77 : 47);
  const offset = bluetooth ? 2 : 0;
  if (bluetooth) {
    data[0] = (sequence & 15) << 4;
    data[1] = 0x10;
  }
  data[offset] = 0x0c; // Only the left and right trigger effects; do not switch audio/rumble modes.
  for (const start of [offset + 10, offset + 21]) {
    data[start] = strength > 0 ? 0x01 : 0x05;
    data[start + 1] = strength > 0 ? 48 : 0;
    data[start + 2] = Math.round(Math.max(0, Math.min(1, strength)) * 160);
  }
  if (bluetooth) checksum(0x31, data);
  return data;
}

/** Bluetooth PCM: 32 stereo signed 8-bit samples at 3 kHz, in report 0x32. */
export function pcmReport(sequence: number, samples: Uint8Array): Uint8Array<ArrayBuffer> {
  if (samples.length !== 64) throw new Error('Expected 32 stereo PCM samples');
  const data = new Uint8Array(141);
  data.set([0, 0x91, 7, 0xfe, 0, 0, 0, 0, 0xff, sequence & 255, 0x92, 64]);
  data.set(samples, 12);
  checksum(0x32, data);
  return data;
}
