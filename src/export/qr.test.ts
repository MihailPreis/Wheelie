import { describe, expect, it } from 'vitest';
import { encodeQr, MAX_QR_VERSION, qrCapacity } from './qr';

const bytes = (text: string) => new TextEncoder().encode(text);
/** FNV-1a of a symbol, to pin down symbols that were checked with an independent reader. */
const hash = (modules: Uint8Array) =>
  modules.reduce((sum, module) => Math.imul(sum ^ module, 0x01000193) >>> 0, 0x811c9dc5);

describe('encodeQr', () => {
  it('picks the smallest version the bytes fit', () => {
    expect(encodeQr(bytes('a'.repeat(17)))?.size).toBe(21);
    expect(encodeQr(bytes('a'.repeat(18)))?.size).toBe(25);
    expect(encodeQr(bytes('a'.repeat(qrCapacity(MAX_QR_VERSION))))?.size).toBe(17 + 4 * MAX_QR_VERSION);
  });

  it('gives up when the bytes do not fit', () => {
    expect(encodeQr(bytes('a'.repeat(qrCapacity(MAX_QR_VERSION) + 1)))).toBeNull();
    expect(encodeQr(bytes('a'.repeat(100)), 3)).toBeNull();
  });

  it('holds the capacities of the standard', () => {
    expect([1, 9, 10, 15, 20].map(qrCapacity)).toEqual([17, 230, 271, 520, 858]);
  });

  it('draws the same symbols as when they were read back', () => {
    expect(hash(encodeQr(bytes('https://mihailpreis.github.io/Wheelie/'))?.modules ?? new Uint8Array())).toBe(
      3275218216,
    );
    expect(hash(encodeQr(bytes('Wheelie! '.repeat(60)))?.modules ?? new Uint8Array())).toBe(3843586148);
  });
});
