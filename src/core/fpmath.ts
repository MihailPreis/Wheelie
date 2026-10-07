/**
 * 16.16 fixed-point arithmetic with the exact semantics of the original Java code.
 *
 * The original computes through 64-bit `long` intermediates. Those do not fit in a double, so
 * each helper splits the work into steps whose intermediate values stay below 2^53 and are
 * therefore exact. Results must match Java bit for bit: replays depend on it.
 */

export class DivisionByZeroError extends Error {
  constructor() {
    super('Fixed-point division by zero');
    this.name = 'DivisionByZeroError';
  }
}

/**
 * Java: `(long) a * (long) b >> 16`, without the final cast to `int`.
 * The result is an exact integer of up to 48 bits.
 */
export function mulWide(a: number, b: number): number {
  const high = b >> 16;
  const low = b & 0xffff;
  return a * high + Math.floor((a * low) / 65536);
}

/** Java: `(int) ((long) a * (long) b >> 16)`. */
export function mul(a: number, b: number): number {
  return mulWide(a, b) | 0;
}

/** Java: `(int) (((long) a << 32) / (long) b >> 16)`. Division truncates toward zero, the shift floors. */
export function div(a: number, b: number): number {
  if (b === 0) throw new DivisionByZeroError();
  const negative = a < 0 !== b < 0;
  const dividend = Math.abs(a) * 65536;
  const divisor = Math.abs(b);
  const quotient = Math.floor(dividend / divisor);
  if (!negative) return quotient | 0;
  // The shift floors a negative quotient, so any discarded low bits push the result one further down.
  const remainder = dividend - quotient * divisor;
  return -(quotient + (remainder * 65536 >= divisor ? 1 : 0)) | 0;
}

/**
 * Cheap approximation of the length of the vector (x, y) used throughout the original
 * (`Physics._doIII`): 0.983 * max + 0.431 * min.
 */
export function approxLength(x: number, y: number): number {
  const ax = x >= 0 ? x : -x | 0;
  const ay = y >= 0 ? y : -y | 0;
  const major = ay >= ax ? ay : ax;
  const minor = ay >= ax ? ax : ay;
  return (mul(64448, major) + mul(28224, minor)) | 0;
}
