/**
 * A backup of the player's runs: every replay in one file. Nothing else is saved — progress,
 * high scores and achievements are worked out again from the runs when the file is read, so a
 * backup cannot claim what was not ridden.
 *
 * Layout, big-endian: magic `WHP\x1a`, format version (1 byte), number of replays (4 bytes), then
 * for each replay its length (4 bytes) and its bytes in the `.gdr` format.
 */

const MAGIC = [0x57, 0x48, 0x50, 0x1a];
const VERSION = 1;
const HEADER = 9;
export const MAX_PROFILE_BYTES = 64 * 1024 * 1024;
const MAX_REPLAYS = 20_000;

export function isProfile(bytes: Uint8Array): boolean {
  return MAGIC.every((byte, index) => bytes[index] === byte);
}

export function encodeProfile(replays: readonly Uint8Array[]): Uint8Array {
  const size = replays.reduce((sum, replay) => sum + 4 + replay.length, HEADER);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC);
  bytes[4] = VERSION;
  view.setUint32(5, replays.length);
  let offset = HEADER;
  for (const replay of replays) {
    view.setUint32(offset, replay.length);
    bytes.set(replay, offset + 4);
    offset += 4 + replay.length;
  }
  return bytes;
}

/** The replays of a backup, still encoded. Throws if the file is not a backup this version reads. */
export function decodeProfile(bytes: Uint8Array, maxReplayBytes: number): Uint8Array[] {
  if (bytes.length < HEADER || bytes.length > MAX_PROFILE_BYTES || !isProfile(bytes)) throw new Error('Not a backup');
  if (bytes[4] !== VERSION) throw new Error('A backup of another version');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(5);
  if (count > MAX_REPLAYS) throw new Error('Too many replays');
  const replays: Uint8Array[] = [];
  let offset = HEADER;
  for (let index = 0; index < count; index++) {
    if (offset + 4 > bytes.length) throw new Error('The backup is cut short');
    const length = view.getUint32(offset);
    offset += 4;
    if (length > maxReplayBytes || offset + length > bytes.length) throw new Error('The backup is cut short');
    replays.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  return replays;
}
