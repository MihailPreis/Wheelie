/**
 * Reader for `levels.mrg`, the level pack format of Gravity Defied.
 *
 * Layout (big-endian): three sections — easy, medium, hard — each an `int32` track count followed
 * by that many entries of `int32` file offset plus a zero-terminated CP-1251 name. Track data sits
 * at the given offsets. Ported from `Levels/Reader.java` and `Levels/Level.readTrackData`.
 */

export const LEVEL_COUNT = 3;
const MAX_TRACKS_PER_LEVEL = 16384;
const MAX_NAME_BYTES = 40;

export class InvalidPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPackError';
  }
}

export interface TrackEntry {
  name: string;
  /** Offset of the track data from the start of the file. */
  offset: number;
}

export interface PackHeader {
  /** Track lists for the easy, medium and hard levels, in that order. */
  levels: TrackEntry[][];
}

export interface TrackData {
  startX: number;
  startY: number;
  finishX: number;
  finishY: number;
  /** Interleaved x, y pairs in 16.16 fixed point, strictly increasing in x. */
  points: Int32Array;
  pointCount: number;
  /** The data ended before the declared number of points was read. The original keeps what it got. */
  truncated: boolean;
}

// Windows-1251, bytes 0x80–0xBF. Bytes 0xC0–0xFF map linearly onto U+0410–U+044F.
const CP1251_HIGH = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕї';

function decodeCp1251(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (let i = start; i < end; i++) {
    const byte = bytes[i] as number;
    if (byte < 0x80) text += String.fromCharCode(byte);
    else if (byte < 0xc0) text += CP1251_HIGH[byte - 0x80];
    else text += String.fromCharCode(0x410 + byte - 0xc0);
  }
  return text;
}

export function parsePackHeader(bytes: Uint8Array): PackHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const levels: TrackEntry[][] = [];
  let position = 0;

  const need = (count: number) => {
    if (position + count > bytes.length) throw new InvalidPackError('Unexpected end of level pack header');
  };

  for (let level = 0; level < LEVEL_COUNT; level++) {
    need(4);
    const count = view.getInt32(position);
    position += 4;
    if (count > MAX_TRACKS_PER_LEVEL) throw new InvalidPackError('Level pack is not valid');

    const tracks: TrackEntry[] = [];
    for (let track = 0; track < count; track++) {
      need(4);
      const offset = view.getInt32(position);
      position += 4;

      // The name ends at a zero byte. A name that fills all 40 bytes has no terminator and is dropped.
      const nameStart = position;
      let name = '';
      for (;;) {
        if (position - nameStart >= MAX_NAME_BYTES) break;
        need(1);
        if (bytes[position++] === 0) {
          name = decodeCp1251(bytes, nameStart, position - 1).replaceAll('_', ' ');
          break;
        }
      }
      tracks.push({ name, offset });
    }
    levels.push(tracks);
  }
  return { levels };
}

/** Java: `(x << 16) >> 3`, with `int` overflow. */
function unpack(value: number): number {
  return (value << 16) >> 3;
}

export function parseTrack(bytes: Uint8Array, offset: number): TrackData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = offset > 0 ? offset : 0;
  let failed = false;

  const available = (count: number) => {
    if (position + count > bytes.length) failed = true;
    return !failed;
  };
  const int8 = () => (available(1) ? view.getInt8(position++) : 0);
  const int32 = () => {
    if (!available(4)) return 0;
    position += 4;
    return view.getInt32(position - 4);
  };
  const int16 = () => {
    if (!available(2)) return 0;
    position += 2;
    return view.getInt16(position - 2);
  };

  const track: TrackData = {
    startX: 0,
    startY: 0,
    finishX: 0xc80000,
    finishY: 0,
    points: new Int32Array(0),
    pointCount: 0,
    truncated: false,
  };
  const points: number[] = [];
  // Points whose x does not increase are silently skipped (`Level.addPoint`).
  const addPoint = (x: number, y: number) => {
    const px = unpack(x);
    if (points.length === 0 || (points[points.length - 2] as number) < px) points.push(px, unpack(y));
  };

  // Stops at the first read past the end of the data, keeping everything read before it.
  const read = () => {
    // An optional 20-byte block, marked by a leading '2'.
    if (int8() === 50) {
      if (!available(20)) return;
      position += 20;
    }
    if (failed) return;

    // Each field is assigned as soon as it is read, so a cut-off header leaves the rest at defaults.
    const startX = int32();
    if (failed) return;
    track.startX = startX;
    const startY = int32();
    if (failed) return;
    track.startY = startY;
    const finishX = int32();
    if (failed) return;
    track.finishX = finishX;
    const finishY = int32();
    if (failed) return;
    track.finishY = finishY;

    const declared = int16();
    let x = int32();
    let y = int32();
    if (failed) return;
    addPoint(x, y);

    // Each further point is a pair of signed byte deltas, or -1 followed by absolute coordinates.
    for (let i = 1; i < declared; i++) {
      let dx = int8();
      let dy: number;
      if (failed) return;
      if (dx === -1) {
        x = 0;
        y = 0;
        dx = int32();
        dy = int32();
      } else {
        dy = int8();
      }
      if (failed) return;
      x = (x + dx) | 0;
      y = (y + dy) | 0;
      addPoint(x, y);
    }
  };
  read();

  track.truncated = failed;
  track.points = Int32Array.from(points);
  track.pointCount = points.length / 2;
  return track;
}

// ---- writing ------------------------------------------------------------------------------

/** Coordinates in a pack file are whole numbers of this many simulation units (see {@link unpack}). */
export const FILE_UNIT = 8192;
/** Range of a coordinate in file units; beyond it the original's arithmetic overflows. */
export const FILE_COORDINATE_LIMIT = 32767;
/** The point count is stored in 16 bits. */
export const MAX_TRACK_POINTS = 32767;

function encodeCp1251(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    const high = CP1251_HIGH.indexOf(char);
    if (code < 0x80) bytes.push(code);
    else if (code >= 0x410 && code <= 0x44f) bytes.push(code - 0x410 + 0xc0);
    else if (high >= 0) bytes.push(high + 0x80);
    // Anything the encoding cannot hold.
    else bytes.push(0x3f);
  }
  return bytes;
}

/** The bytes a track name takes in a pack: CP-1251, spaces as underscores, at most 39 bytes. */
export function encodeTrackName(name: string): number[] {
  return encodeCp1251(name.replaceAll(' ', '_')).slice(0, MAX_NAME_BYTES - 1);
}

/**
 * Writes one track the way `Level.readTrackData` reads it. The points must lie on whole file
 * units; throws {@link InvalidPackError} for a track the format cannot hold.
 */
export function encodeTrack(track: TrackData): Uint8Array {
  const count = track.pointCount;
  if (count < 1 || count > MAX_TRACK_POINTS) throw new InvalidPackError('The number of points does not fit the format');
  const bytes: number[] = [];
  const int32 = (value: number) =>
    bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  const unit = (value: number) => {
    const whole = value / FILE_UNIT;
    if (!Number.isInteger(whole) || Math.abs(whole) > FILE_COORDINATE_LIMIT) {
      throw new InvalidPackError('A point does not fit the format');
    }
    return whole;
  };

  // Anything but '2', which would announce a 20-byte block; the original files have '3' here.
  bytes.push(51);
  int32(track.startX);
  int32(track.startY);
  int32(track.finishX);
  int32(track.finishY);
  bytes.push((count >> 8) & 0xff, count & 0xff);
  let x = unit(track.points[0] as number);
  let y = unit(track.points[1] as number);
  int32(x);
  int32(y);
  for (let i = 1; i < count; i++) {
    const nextX = unit(track.points[i * 2] as number);
    const nextY = unit(track.points[i * 2 + 1] as number);
    const dx = nextX - x;
    const dy = nextY - y;
    // A step of -1 in x is the marker for absolute coordinates, so it cannot be written as a step.
    if (dx >= -128 && dx <= 127 && dx !== -1 && dy >= -128 && dy <= 127) {
      bytes.push(dx & 0xff, dy & 0xff);
    } else {
      bytes.push(0xff);
      int32(nextX);
      int32(nextY);
    }
    x = nextX;
    y = nextY;
  }
  return Uint8Array.from(bytes);
}

/** Builds a whole `.mrg` file from the tracks of the three levels. */
export function encodePack(levels: readonly (readonly { name: string; data: TrackData }[])[]): Uint8Array {
  if (levels.length !== LEVEL_COUNT) throw new InvalidPackError('A pack has exactly three levels');
  const names = levels.map((level) => level.map((track) => encodeTrackName(track.name)));
  const tracks = levels.map((level) => level.map((track) => encodeTrack(track.data)));
  let offset = 0;
  for (const level of names) {
    offset += 4;
    for (const name of level) offset += 4 + name.length + 1;
  }
  const size = tracks.flat().reduce((total, track) => total + track.length, offset);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let position = 0;
  levels.forEach((_, level) => {
    view.setInt32(position, names[level]?.length ?? 0);
    position += 4;
    (names[level] ?? []).forEach((name, index) => {
      const data = tracks[level]?.[index] as Uint8Array;
      view.setInt32(position, offset);
      position += 4;
      out.set(name, position);
      position += name.length + 1;
      out.set(data, offset);
      offset += data.length;
    });
  });
  return out;
}
