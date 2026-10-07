import type { TrackData } from './mrg';

/**
 * The replay format (`.gdr`). A replay is the player's inputs, one per simulation tick, plus what
 * is needed to find the track and to check the result. Watching it means simulating it again.
 *
 * Everything read here may come from a stranger's link or file: every length is bounded and any
 * inconsistency throws {@link InvalidReplayError}. The layout is described in docs/replay-format.md.
 */

export const REPLAY_FORMAT_VERSION = 1;

const MAGIC = [0x47, 0x44, 0x52, 0x1a]; // "GDR" and a byte no text file contains.
const FLAG_TRACK = 1;
const FLAG_WHEELIE = 2;

/** Longest replay accepted: a hundred minutes of 15 ms ticks. */
export const MAX_REPLAY_TICKS = 400_000;
export const MAX_REPLAY_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 120;
const MAX_TRACK_POINTS = 100_000;
/** Throttle and lean each take three values, so a tick's input is one of nine codes. */
const INPUT_CODES = 9;

export const Outcome = {
  /** The run was left before it ended. */
  Abandoned: 0,
  Crashed: 1,
  Finished: 2,
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export interface Replay {
  /** Version of the simulation the inputs were recorded against. */
  physicsVersion: number;
  /** Identifier of the level pack: `original`, `gdtr-<number>` or `file-<hash>`. */
  packId: string;
  level: number;
  track: number;
  league: number;
  /** Hash of the track data, so a pack that has changed is not mistaken for the one that was ridden. */
  trackHash: number;
  trackName: string;
  player: string;
  /** When the run was made, in seconds since the Unix epoch. */
  date: number;
  outcome: Outcome;
  /** The front wheel never touched the ground. */
  wheelie: boolean;
  /** Race time in milliseconds; 0 unless the run was finished. */
  time: number;
  /** Hash of the simulation state after the last tick. */
  finalHash: number;
  /** One input code per tick; see {@link inputCode}. */
  inputs: Uint8Array;
  /** The track itself, for tracks a viewer could not get from the bundled catalogue. */
  trackData: TrackData | null;
}

export class InvalidReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReplayError';
  }
}

export const inputCode = (throttle: number, lean: number) => (throttle + 1) * 3 + (lean + 1);
export const inputThrottle = (code: number) => Math.floor(code / 3) - 1;
export const inputLean = (code: number) => (code % 3) - 1;

/** 32-bit FNV-1a over the numbers that define a track. */
export function hashTrack(track: TrackData): number {
  let hash = 0x811c9dc5 | 0;
  const add = (word: number) => {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (word >>> shift) & 0xff;
      hash = Math.imul(hash, 16777619);
    }
  };
  add(track.startX);
  add(track.startY);
  add(track.finishX);
  add(track.finishY);
  add(track.pointCount);
  for (let i = 0; i < track.pointCount * 2; i++) add(track.points[i] as number);
  return hash >>> 0;
}

// ---- writing ------------------------------------------------------------------------------

class Writer {
  private bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  /** Unsigned LEB128, for values below 2^32. */
  varint(value: number): void {
    let rest = value >>> 0;
    while (rest >= 0x80) {
      this.bytes.push((rest & 0x7f) | 0x80);
      rest >>>= 7;
    }
    this.bytes.push(rest);
  }

  /** A signed 32-bit value, zigzag-encoded so small magnitudes stay short. */
  signed(value: number): void {
    this.varint(((value << 1) ^ (value >> 31)) >>> 0);
  }

  uint32(value: number): void {
    for (let shift = 0; shift < 32; shift += 8) this.bytes.push((value >>> shift) & 0xff);
  }

  /** UTF-8, preceded by its length in bytes. */
  text(value: string): void {
    const encoded: number[] = [];
    for (const char of value) {
      const point = char.codePointAt(0) as number;
      if (point < 0x80) encoded.push(point);
      else if (point < 0x800) encoded.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
      else if (point < 0x10000) encoded.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      else {
        encoded.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
      }
      if (encoded.length > MAX_TEXT_BYTES) throw new InvalidReplayError('Text is too long');
    }
    this.varint(encoded.length);
    for (const byte of encoded) this.bytes.push(byte);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export function encodeReplay(replay: Replay): Uint8Array {
  if (replay.inputs.length > MAX_REPLAY_TICKS) throw new InvalidReplayError('The run is too long');
  const out = new Writer();
  for (const byte of MAGIC) out.byte(byte);
  out.varint(REPLAY_FORMAT_VERSION);
  out.varint(replay.physicsVersion);
  out.byte((replay.trackData ? FLAG_TRACK : 0) | (replay.wheelie ? FLAG_WHEELIE : 0));
  out.text(replay.packId);
  out.varint(replay.level);
  out.varint(replay.track);
  out.varint(replay.league);
  out.uint32(replay.trackHash);
  out.text(replay.trackName);
  out.text(replay.player);
  out.varint(replay.date);
  out.byte(replay.outcome);
  out.varint(replay.time);
  out.uint32(replay.finalHash);

  const track = replay.trackData;
  if (track) {
    out.signed(track.startX);
    out.signed(track.startY);
    out.signed(track.finishX);
    out.signed(track.finishY);
    out.varint(track.pointCount);
    let x = 0;
    let y = 0;
    for (let i = 0; i < track.pointCount; i++) {
      const px = track.points[i * 2] as number;
      const py = track.points[i * 2 + 1] as number;
      out.signed((px - x) | 0);
      out.signed((py - y) | 0);
      x = px;
      y = py;
    }
  }

  // Inputs change a few times a second, so runs of equal ticks are stored as (code, length):
  // one byte for runs up to 15 ticks, the length as a varint after a zero nibble otherwise.
  const inputs = replay.inputs;
  out.varint(inputs.length);
  for (let start = 0; start < inputs.length; ) {
    const code = inputs[start] as number;
    if (code >= INPUT_CODES) throw new InvalidReplayError('Unknown input code');
    let end = start + 1;
    while (end < inputs.length && inputs[end] === code) end++;
    const length = end - start;
    if (length < 16) {
      out.byte(code | (length << 4));
    } else {
      out.byte(code);
      out.varint(length);
    }
    start = end;
  }
  return out.finish();
}

// ---- reading ------------------------------------------------------------------------------

class Reader {
  private position = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.position === this.bytes.length;
  }

  byte(): number {
    if (this.position >= this.bytes.length) throw new InvalidReplayError('The replay is cut short');
    return this.bytes[this.position++] as number;
  }

  varint(): number {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = this.byte();
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) {
        if (value > 0xffffffff) break;
        return value;
      }
    }
    throw new InvalidReplayError('A number is out of range');
  }

  signed(): number {
    const value = this.varint();
    return (value >>> 1) ^ -(value & 1);
  }

  uint32(): number {
    let value = 0;
    for (let shift = 0; shift < 32; shift += 8) value += this.byte() * 2 ** shift;
    return value;
  }

  /** A varint that must not exceed `limit`. */
  bounded(limit: number, what: string): number {
    const value = this.varint();
    if (value > limit) throw new InvalidReplayError(`${what} is out of range`);
    return value;
  }

  text(): string {
    const length = this.bounded(MAX_TEXT_BYTES, 'Text length');
    let text = '';
    const end = this.position + length;
    if (end > this.bytes.length) throw new InvalidReplayError('The replay is cut short');
    while (this.position < end) {
      const lead = this.byte();
      const extra = lead < 0x80 ? 0 : lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : -1;
      if (extra < 0 || this.position + extra > end) throw new InvalidReplayError('Text is not valid UTF-8');
      let point = extra === 0 ? lead : lead & (0x3f >> extra);
      for (let i = 0; i < extra; i++) {
        const next = this.byte();
        if ((next & 0xc0) !== 0x80) throw new InvalidReplayError('Text is not valid UTF-8');
        point = point * 64 + (next & 0x3f);
      }
      if (point > 0x10ffff || (point >= 0xd800 && point < 0xe000))
        throw new InvalidReplayError('Text is not valid UTF-8');
      text += String.fromCodePoint(point);
    }
    return text;
  }
}

export function decodeReplay(bytes: Uint8Array): Replay {
  if (bytes.length > MAX_REPLAY_BYTES) throw new InvalidReplayError('The replay is too large');
  const input = new Reader(bytes);
  for (const byte of MAGIC) {
    if (input.byte() !== byte) throw new InvalidReplayError('This is not a replay');
  }
  const version = input.varint();
  if (version !== REPLAY_FORMAT_VERSION) throw new InvalidReplayError(`Replay format ${version} is not supported`);
  const physicsVersion = input.varint();
  const flags = input.byte();
  const packId = input.text();
  const level = input.bounded(2, 'Level');
  const track = input.bounded(0xffff, 'Track');
  const league = input.bounded(3, 'League');
  const trackHash = input.uint32();
  const trackName = input.text();
  const player = input.text();
  const date = input.varint();
  const outcome = input.byte();
  if (outcome !== Outcome.Abandoned && outcome !== Outcome.Crashed && outcome !== Outcome.Finished) {
    throw new InvalidReplayError('Unknown outcome');
  }
  const time = input.varint();
  const finalHash = input.uint32();

  let trackData: TrackData | null = null;
  if (flags & FLAG_TRACK) {
    const startX = input.signed();
    const startY = input.signed();
    const finishX = input.signed();
    const finishY = input.signed();
    const pointCount = input.bounded(MAX_TRACK_POINTS, 'Track size');
    const points = new Int32Array(pointCount * 2);
    let x = 0;
    let y = 0;
    for (let i = 0; i < pointCount; i++) {
      x = (x + input.signed()) | 0;
      y = (y + input.signed()) | 0;
      points[i * 2] = x;
      points[i * 2 + 1] = y;
    }
    trackData = { startX, startY, finishX, finishY, points, pointCount, truncated: false };
  }

  const ticks = input.bounded(MAX_REPLAY_TICKS, 'Length');
  const inputs = new Uint8Array(ticks);
  let filled = 0;
  while (filled < ticks) {
    const head = input.byte();
    const code = head & 0x0f;
    if (code >= INPUT_CODES) throw new InvalidReplayError('Unknown input code');
    const length = head >> 4 || input.varint();
    // A zero-length run would let a short file spin this loop for ever.
    if (length === 0 || length > ticks - filled) throw new InvalidReplayError('Input runs do not add up');
    inputs.fill(code, filled, filled + length);
    filled += length;
  }
  if (!input.done) throw new InvalidReplayError('Unexpected data after the replay');

  return {
    physicsVersion,
    packId,
    level,
    track,
    league,
    trackHash,
    trackName,
    player,
    date,
    outcome,
    wheelie: (flags & FLAG_WHEELIE) !== 0,
    time,
    finalHash,
    inputs,
    trackData,
  };
}
