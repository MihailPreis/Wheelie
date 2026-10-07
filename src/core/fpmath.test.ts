import { describe, expect, it } from 'vitest';
import { approxLength, DivisionByZeroError, div, mul, mulWide } from './fpmath';

// Reference implementations on BigInt, written straight from the Java expressions.
const refMulWide = (a: number, b: number) => (BigInt(a) * BigInt(b)) >> 16n;
const refMul = (a: number, b: number) => Number(BigInt.asIntN(32, refMulWide(a, b)));
const refDiv = (a: number, b: number) =>
  Number(BigInt.asIntN(32, BigInt.asIntN(64, BigInt.asIntN(64, BigInt(a) << 32n) / BigInt(b)) >> 16n));

const EDGES = [
  0, 1, -1, 2, -2, 3, -3, 0xffff, 0x10000, 0x10001, -0xffff, -0x10000, -0x10001, 0x7fff, 0x8000, 0x7fffffff,
  -0x7fffffff, -0x80000000, 0x40000000, -0x40000000, 64448, 28224, 6553, 0x190000, 0x60000,
];

function* randomInts(count: number, seed: number): Generator<number> {
  let state = seed | 0;
  for (let i = 0; i < count; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // Vary the magnitude so small and large operands are both covered.
    yield state >> ((state >>> 27) & 31);
  }
}

describe('mul', () => {
  it('matches Java on edge values', () => {
    for (const a of EDGES) {
      for (const b of EDGES) {
        expect(mul(a, b), `${a} * ${b}`).toBe(refMul(a, b));
        expect(BigInt(mulWide(a, b)), `wide ${a} * ${b}`).toBe(refMulWide(a, b));
      }
    }
  });

  it('matches Java on random values', () => {
    const values = [...randomInts(40000, 0x1234567)];
    for (let i = 0; i + 1 < values.length; i += 2) {
      const a = values[i] as number;
      const b = values[i + 1] as number;
      if (mul(a, b) !== refMul(a, b)) throw new Error(`mul(${a}, ${b})`);
      if (BigInt(mulWide(a, b)) !== refMulWide(a, b)) throw new Error(`mulWide(${a}, ${b})`);
    }
  });
});

describe('div', () => {
  it('matches Java on edge values', () => {
    for (const a of EDGES) {
      for (const b of EDGES) {
        if (b === 0) continue;
        expect(div(a, b), `${a} / ${b}`).toBe(refDiv(a, b));
      }
    }
  });

  it('matches Java on random values', () => {
    const values = [...randomInts(40000, 0x7654321)];
    for (let i = 0; i + 1 < values.length; i += 2) {
      const a = values[i] as number;
      const b = values[i + 1] as number;
      if (b === 0) continue;
      if (div(a, b) !== refDiv(a, b)) throw new Error(`div(${a}, ${b})`);
    }
  });

  it('throws on division by zero, like Java', () => {
    expect(() => div(1, 0)).toThrow(DivisionByZeroError);
  });
});

describe('approxLength', () => {
  it('is symmetric and sign-independent', () => {
    expect(approxLength(0x30000, 0x40000)).toBe(approxLength(-0x40000, 0x30000));
    expect(approxLength(0x10000, 0)).toBe(64448);
    expect(approxLength(0, 0)).toBe(0);
  });
});
