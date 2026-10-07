import { decodeReplay, Outcome, type Replay } from '../../src/formats/replay';

/**
 * Short links for replays, with a preview. The game itself needs no server: a replay link carries
 * the whole replay in the fragment of the address. But a fragment never reaches a server, so such a
 * link can show no preview in a messenger, and it is long. This service stores a replay and the
 * picture of its result under a short identifier, serves a page with preview tags for it, and
 * sends people on to the game with the replay in the fragment.
 */

/** The part of Cloudflare's KV interface this service uses. */
export interface Store {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: ArrayBuffer | string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  LINKS: Store;
  /** Address of the game, where replay links open. */
  SITE_URL: string;
}

/** A replay of an hour of riding with constantly changing input is far below this. */
const MAX_REPLAY_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 400 * 1024;
const MAX_BODY_BYTES = Math.ceil((MAX_REPLAY_BYTES + MAX_IMAGE_BYTES) * 1.4) + 1024;
/** Links one address may create in an hour. */
const HOURLY_LIMIT = 30;
const YEAR_SECONDS = 365 * 24 * 3600;
/** Replays are tiny and kept for two years; pictures are a thousand times larger and kept for half a year. */
const REPLAY_TTL = 2 * YEAR_SECONDS;
const IMAGE_TTL = YEAR_SECONDS / 2;
const ID = /^[0-9A-Za-z]{10}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const refuse = (status: number, error: string) => json({ error }, status);

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function fromBase64(text: unknown, limit: number): Uint8Array<ArrayBuffer> | null {
  if (typeof text !== 'string' || text.length > limit * 1.4 + 8 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytes.length <= limit ? bytes : null;
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The identifier of a replay: ten characters drawn from the hash of its bytes. */
async function identify(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let id = '';
  for (let i = 0; i < 10; i++) id += ALPHABET[(digest[i] as number) % ALPHABET.length];
  return id;
}

/** A PNG of the size the game's result card has. Nothing else is stored as a picture. */
function isResultCard(bytes: Uint8Array): boolean {
  if (bytes.length < 24 || !PNG_MAGIC.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16) === 1200 && view.getUint32(20) === 630;
}

function describe(replay: Replay): { title: string; text: string } {
  const hundredths = Math.floor(replay.time / 10);
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${pad(Math.floor(hundredths / 6000))}:${pad(Math.floor(hundredths / 100) % 60)}.${pad(hundredths % 100)}`;
  const league = ['100cc', '175cc', '220cc', '325cc'][replay.league] ?? '';
  const result =
    replay.outcome === Outcome.Finished ? time : replay.outcome === Outcome.Crashed ? 'crashed' : 'not finished';
  return {
    title: `${replay.trackName || 'A run'} - ${result} - Wheelie!`,
    text: `${replay.player ? `${replay.player} on ` : ''}${league}. Watch the replay and race it as a ghost.`,
  };
}

async function create(request: Request, env: Env): Promise<Response> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_BODY_BYTES) return refuse(413, 'too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return refuse(413, 'too large');
  let body: { replay?: unknown; image?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return refuse(400, 'not JSON');
  }
  const replay = fromBase64(body?.replay, MAX_REPLAY_BYTES);
  if (!replay) return refuse(400, 'no replay');
  try {
    decodeReplay(replay);
  } catch {
    return refuse(400, 'not a replay');
  }
  const image = body.image === undefined ? null : fromBase64(body.image, MAX_IMAGE_BYTES);
  if (image && !isResultCard(image)) return refuse(400, 'not a result card');

  // A crude brake on anyone filling the store: a counter per address and hour.
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const quota = `q:${address}:${Math.floor(Date.now() / 3_600_000)}`;
  const used = Number((await env.LINKS.get(quota, 'text')) ?? 0);
  if (used >= HOURLY_LIMIT) return refuse(429, 'too many links');
  await env.LINKS.put(quota, String(used + 1), { expirationTtl: 7200 });

  const id = await identify(replay);
  await env.LINKS.put(`r:${id}`, replay.buffer, { expirationTtl: REPLAY_TTL });
  if (image) await env.LINKS.put(`i:${id}`, image.buffer, { expirationTtl: IMAGE_TTL });
  return json({ id, url: `${new URL(request.url).origin}/r/${id}` });
}

async function page(id: string, origin: string, env: Env): Promise<Response> {
  const site = env.SITE_URL.endsWith('/') ? env.SITE_URL : `${env.SITE_URL}/`;
  const stored = await env.LINKS.get(`r:${id}`, 'arrayBuffer');
  if (!stored) return Response.redirect(site, 302);
  const bytes = new Uint8Array(stored);
  let replay: Replay;
  try {
    replay = decodeReplay(bytes);
  } catch {
    return Response.redirect(site, 302);
  }
  const hasImage = (await env.LINKS.get(`i:${id}`, 'arrayBuffer')) !== null;
  const { title, text } = describe(replay);
  const image = hasImage ? `${origin}/i/${id}.png` : `${site}assets/brand/preview.png`;
  const target = `${site}#r=p${toBase64Url(bytes)}`;
  // Everything taken from the replay is text a stranger wrote; it is escaped wherever it goes.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(text)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Wheelie!">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(text)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${escapeHtml(`${origin}/r/${id}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">
</head>
<body>
<p><a href="${escapeHtml(target)}">${escapeHtml(title)}</a></p>
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

async function picture(id: string, env: Env): Promise<Response> {
  const stored = await env.LINKS.get(`i:${id}`, 'arrayBuffer');
  if (!stored) return new Response('Not found', { status: 404 });
  return new Response(stored, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800, immutable' },
  });
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/api/links') {
    return request.method === 'POST' ? create(request, env) : refuse(405, 'POST only');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const link = /^\/r\/([^/]+)$/.exec(url.pathname)?.[1];
  if (link && ID.test(link)) return page(link, url.origin, env);
  const image = /^\/i\/([^/]+)\.png$/.exec(url.pathname)?.[1];
  if (image && ID.test(image)) return picture(image, env);
  if (url.pathname === '/') return Response.redirect(env.SITE_URL, 302);
  return new Response('Not found', { status: 404 });
}
