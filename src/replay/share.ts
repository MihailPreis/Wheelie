import { MAX_REPLAY_BYTES } from '../formats/replay';

/**
 * A replay as a link: the whole replay sits in the fragment of the address, so nothing is sent to
 * any server. The fragment is `r=`, one character naming the packing, then base64url data.
 */

const PREFIX = '#r=';
/** A track from the editor travels the same way, as a level pack of one track. */
const TRACK_PREFIX = '#t=';
/** No track the editor can make comes anywhere near this. */
const MAX_TRACK_BYTES = 64 * 1024;
const PACKED = 'd'; // deflate-raw
const PLAIN = 'p';
/** Links longer than this get cut or refused by some messengers; the file is the safer way then. */
export const COMFORTABLE_LINK_LENGTH = 2000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Runs bytes through a (de)compression stream, giving up once the output passes `limit`. */
async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  through: GenericTransformStream,
  limit: number,
): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(through).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      // A few bytes of deflate can unpack to gigabytes.
      await reader.cancel();
      throw new Error('The data unpacks to more than a replay can hold');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function encodeLink(baseUrl: string, replay: Uint8Array<ArrayBuffer>): Promise<string> {
  return encode(baseUrl, PREFIX, replay);
}

export function encodeTrackLink(baseUrl: string, pack: Uint8Array<ArrayBuffer>): Promise<string> {
  return encode(baseUrl, TRACK_PREFIX, pack);
}

async function encode(baseUrl: string, prefix: string, replay: Uint8Array<ArrayBuffer>): Promise<string> {
  let kind = PLAIN;
  let data: Uint8Array = replay;
  if (typeof CompressionStream !== 'undefined') {
    try {
      const packed = await pipe(replay, new CompressionStream('deflate-raw'), MAX_REPLAY_BYTES);
      if (packed.length < replay.length) {
        kind = PACKED;
        data = packed;
      }
    } catch {
      // The plain form works everywhere.
    }
  }
  return `${baseUrl.replace(/#.*$/, '')}${prefix}${kind}${toBase64Url(data)}`;
}

/** Whether an address fragment claims to carry a replay. */
export const isReplayFragment = (fragment: string) => fragment.startsWith(PREFIX);

/** The replay bytes carried by an address fragment. Throws if they cannot be recovered. */
export function decodeFragment(fragment: string): Promise<Uint8Array> {
  if (!isReplayFragment(fragment)) return Promise.reject(new Error('No replay in the address'));
  return decode(fragment, MAX_REPLAY_BYTES);
}

/** Whether an address fragment claims to carry a track. */
export const isTrackFragment = (fragment: string) => fragment.startsWith(TRACK_PREFIX);

/** The level pack carried by an address fragment. Throws if it cannot be recovered. */
export function decodeTrackFragment(fragment: string): Promise<Uint8Array> {
  if (!isTrackFragment(fragment)) return Promise.reject(new Error('No track in the address'));
  return decode(fragment, MAX_TRACK_BYTES);
}

async function decode(fragment: string, limit: number): Promise<Uint8Array> {
  const kind = fragment[PREFIX.length];
  const text = fragment.slice(PREFIX.length + 1);
  // Base64 grows data by a third; anything longer cannot be within the size limit.
  if (text.length > limit * 1.4) throw new Error('The link is too long');
  const data = fromBase64Url(text);
  if (kind === PLAIN) {
    if (data.length > limit) throw new Error('The link is too long');
    return data;
  }
  if (kind === PACKED) return pipe(Uint8Array.from(data), new DecompressionStream('deflate-raw'), limit);
  throw new Error('Unknown link format');
}
