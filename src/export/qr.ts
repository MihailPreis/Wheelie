/**
 * A QR code encoder, as small as the result card needs: bytes only, error correction level L,
 * versions 1 to 20. Follows ISO/IEC 18004.
 */

/** Error correction codewords per block and number of blocks at level L, by version. */
const EC_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28];
const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8];
export const MAX_QR_VERSION = EC_PER_BLOCK.length;

/** Codewords a symbol of a version holds, data and error correction together. */
function rawCodewords(version: number): number {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2;
    bits -= (25 * aligns - 10) * aligns - 55;
    if (version >= 7) bits -= 36;
  }
  return bits >>> 3;
}

const ecPerBlock = (version: number) => EC_PER_BLOCK[version - 1] as number;
const blockCount = (version: number) => BLOCKS[version - 1] as number;
const dataCodewords = (version: number) => rawCodewords(version) - ecPerBlock(version) * blockCount(version);
const countBits = (version: number) => (version <= 9 ? 8 : 16);

/** Most bytes a code of a version can carry. */
export const qrCapacity = (version: number) => Math.floor((dataCodewords(version) * 8 - 4 - countBits(version)) / 8);

// ---- Reed-Solomon over GF(256) --------------------------------------------------------------

function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j] as number, root);
      if (j + 1 < degree) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = multiply(root, 2);
  }
  return result;
}

function remainder(data: Uint8Array, generator: Uint8Array): Uint8Array {
  const result = new Uint8Array(generator.length);
  for (const byte of data) {
    const factor = byte ^ (result[0] as number);
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++)
      result[i] = (result[i] as number) ^ multiply(generator[i] as number, factor);
  }
  return result;
}

/** The bytes of a message framed, padded, protected and interleaved into the codewords of a symbol. */
function codewords(bytes: Uint8Array, version: number): Uint8Array {
  const capacity = dataCodewords(version);
  const data = new Uint8Array(capacity);
  let length = 0;
  const push = (value: number, bits: number) => {
    for (let i = bits - 1; i >= 0; i--, length++) {
      data[length >>> 3] = (data[length >>> 3] as number) | (((value >>> i) & 1) << (7 - (length & 7)));
    }
  };
  push(4, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - length));
  push(0, (8 - (length % 8)) % 8);
  for (let pad = 0xec; length < capacity * 8; pad ^= 0xec ^ 0x11) push(pad, 8);

  const blocks = blockCount(version);
  const ecLength = ecPerBlock(version);
  const raw = rawCodewords(version);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks) - ecLength;
  const generator = divisor(ecLength);
  const parts: { data: Uint8Array; ec: Uint8Array }[] = [];
  for (let block = 0, at = 0; block < blocks; block++) {
    const part = data.subarray(at, at + shortLength + (block < shortBlocks ? 0 : 1));
    at += part.length;
    parts.push({ data: part, ec: remainder(part, generator) });
  }
  const result = new Uint8Array(raw);
  let out = 0;
  for (let i = 0; i <= shortLength; i++) {
    for (const part of parts) if (i < part.data.length) result[out++] = part.data[i] as number;
  }
  for (let i = 0; i < ecLength; i++) {
    for (const part of parts) result[out++] = part.ec[i] as number;
  }
  return result;
}

// ---- the symbol -----------------------------------------------------------------------------

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** How hard a symbol is to read: long runs, solid blocks and an uneven share of dark modules. */
function penalty(modules: Uint8Array, size: number): number {
  let result = 0;
  let dark = 0;
  for (let a = 0; a < size; a++) {
    for (const column of [false, true]) {
      let run = 0;
      let colour = -1;
      for (let b = 0; b < size; b++) {
        const module = modules[column ? b * size + a : a * size + b] as number;
        if (module === colour) {
          run++;
          if (run === 5) result += 3;
          else if (run > 5) result++;
        } else {
          colour = module;
          run = 1;
        }
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const module = modules[y * size + x] as number;
      dark += module;
      if (
        x + 1 < size &&
        y + 1 < size &&
        module === modules[y * size + x + 1] &&
        module === modules[(y + 1) * size + x] &&
        module === modules[(y + 1) * size + x + 1]
      ) {
        result += 3;
      }
    }
  }
  return result + Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
}

export interface QrCode {
  /** Modules along a side. */
  size: number;
  /** Row by row, 1 for a dark module. */
  modules: Uint8Array;
}

/** A QR code holding `bytes`, or null if they do not fit a version up to `maxVersion`. */
export function encodeQr(bytes: Uint8Array, maxVersion = MAX_QR_VERSION): QrCode | null {
  let version = 1;
  while (version <= maxVersion && qrCapacity(version) < bytes.length) version++;
  if (version > Math.min(maxVersion, MAX_QR_VERSION)) return null;

  const size = 17 + 4 * version;
  const fixed = new Uint8Array(size * size);
  const base = new Uint8Array(size * size);
  const set = (target: Uint8Array, x: number, y: number, dark: boolean) => {
    target[y * size + x] = dark ? 1 : 0;
    fixed[y * size + x] = 1;
  };

  for (let i = 0; i < size; i++) {
    set(base, 6, i, i % 2 === 0);
    set(base, i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(base, x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const aligns: number[] = [];
  if (version > 1) {
    const count = Math.floor(version / 7) + 2;
    const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    for (let position = size - 7; aligns.length < count - 1; position -= step) aligns.unshift(position);
    aligns.unshift(6);
  }
  aligns.forEach((cx, i) => {
    aligns.forEach((cy, j) => {
      const last = aligns.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(base, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });
  if (version >= 7) {
    let rest = version;
    for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
    const bits = (version << 12) | rest;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(base, a, b, dark);
      set(base, b, a, dark);
    }
  }
  const drawFormat = (target: Uint8Array, mask: number) => {
    // Level L is 01 in the format information.
    const data = (1 << 3) | mask;
    let rest = data;
    for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
    const bits = ((data << 10) | rest) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(target, 8, i, bit(i));
    set(target, 8, 7, bit(6));
    set(target, 8, 8, bit(7));
    set(target, 7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(target, 14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(target, size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(target, 8, size - 15 + i, bit(i));
    set(target, 8, size - 8, true);
  };
  // Reserves the format areas before the data is laid around them.
  drawFormat(base, 0);

  const data = codewords(bytes, version);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (fixed[y * size + x] || index >= data.length * 8) continue;
        base[y * size + x] = ((data[index >>> 3] as number) >>> (7 - (index & 7))) & 1;
        index++;
      }
    }
  }

  let best: Uint8Array | null = null;
  let least = Number.POSITIVE_INFINITY;
  MASKS.forEach((mask, number) => {
    const modules = base.slice();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fixed[y * size + x] && mask(x, y)) modules[y * size + x] = (modules[y * size + x] as number) ^ 1;
      }
    }
    drawFormat(modules, number);
    const score = penalty(modules, size);
    if (score < least) {
      least = score;
      best = modules;
    }
  });
  return best ? { size, modules: best } : null;
}
