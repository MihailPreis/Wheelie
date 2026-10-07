import { describe, expect, it } from 'vitest';
import { encodeReplay, inputCode, Outcome, type Replay } from '../../src/formats/replay';
import { type Env, handle, type Store } from './handler';

function memoryStore(): Store & { data: Map<string, ArrayBuffer | string> } {
  const data = new Map<string, ArrayBuffer | string>();
  return {
    data,
    get: (async (key: string, type: 'arrayBuffer' | 'text') => {
      const value = data.get(key);
      if (value === undefined) return null;
      return type === 'text' ? String(value) : (value as ArrayBuffer);
    }) as Store['get'],
    put: async (key, value) => {
      data.set(key, value);
    },
  };
}

const replay = (overrides: Partial<Replay> = {}): Replay => ({
  physicsVersion: 1,
  packId: 'original',
  level: 0,
  track: 0,
  league: 1,
  trackHash: 1,
  trackName: 'Intro',
  player: 'MIK',
  date: 1_791_400_000,
  outcome: Outcome.Finished,
  wheelie: false,
  time: 61_230,
  finalHash: 2,
  inputs: new Uint8Array(500).fill(inputCode(1, 0)),
  trackData: null,
  ...overrides,
});

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
/** The header of a PNG of the given size; enough for the service to recognise a result card. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

const SERVICE = 'https://links.example';
const env = (): Env & { LINKS: ReturnType<typeof memoryStore> } => ({
  LINKS: memoryStore(),
  SITE_URL: 'https://game.example/wheelie/',
});
const post = (body: unknown, address = '1.2.3.4') =>
  new Request(`${SERVICE}/api/links`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'CF-Connecting-IP': address },
  });

describe('short link service', () => {
  it('stores a replay and serves a preview page that leads to the game', async () => {
    const service = env();
    const bytes = encodeReplay(replay());
    const created = await handle(post({ replay: base64(bytes), image: base64(png(1200, 630)) }), service);
    expect(created.status).toBe(200);
    const { id, url } = (await created.json()) as { id: string; url: string };
    expect(url).toBe(`${SERVICE}/r/${id}`);
    expect(id).toMatch(/^[0-9A-Za-z]{10}$/);

    const page = await handle(new Request(url), service);
    const html = await page.text();
    expect(html).toContain('<meta property="og:title" content="Intro - 01:01.23 - Wheelie!">');
    expect(html).toContain(`<meta property="og:image" content="${SERVICE}/i/${id}.png">`);
    expect(html).toContain('MIK on 175cc');
    // The game opens the replay from the fragment, exactly as from a link it made itself.
    const target = /location\.replace\("([^"]+)"\)/.exec(html)?.[1] ?? '';
    expect(target.startsWith('https://game.example/wheelie/#r=p')).toBe(true);
    const carried = atob(target.split('#r=p')[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? '');
    expect(Uint8Array.from(carried, (char) => char.charCodeAt(0))).toEqual(bytes);

    const image = await handle(new Request(`${SERVICE}/i/${id}.png`), service);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png(1200, 630));
  });

  it('gives the same link for the same replay and falls back to the general preview without a picture', async () => {
    const service = env();
    const body = { replay: base64(encodeReplay(replay({ outcome: Outcome.Crashed, time: 0 }))) };
    const first = (await (await handle(post(body), service)).json()) as { id: string };
    const second = (await (await handle(post(body), service)).json()) as { id: string };
    expect(second.id).toBe(first.id);
    const html = await (await handle(new Request(`${SERVICE}/r/${first.id}`), service)).text();
    expect(html).toContain('Intro - crashed - Wheelie!');
    expect(html).toContain('content="https://game.example/wheelie/assets/brand/preview.png"');
  });

  it('escapes whatever a replay says about itself', async () => {
    const service = env();
    const hostile = replay({ trackName: '"><script>alert(1)</script>', player: '<b>' });
    const { id } = (await (await handle(post({ replay: base64(encodeReplay(hostile)) }), service)).json()) as {
      id: string;
    };
    const html = await (await handle(new Request(`${SERVICE}/r/${id}`), service)).text();
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&#60;script&#62;');
  });

  it('refuses what is not a replay or not a result card', async () => {
    const service = env();
    const good = base64(encodeReplay(replay()));
    expect((await handle(post('nonsense'), service)).status).toBe(400);
    expect((await handle(post({}), service)).status).toBe(400);
    expect((await handle(post({ replay: base64(Uint8Array.from([1, 2, 3])) }), service)).status).toBe(400);
    expect((await handle(post({ replay: good, image: base64(png(10, 10)) }), service)).status).toBe(400);
    expect((await handle(post({ replay: good, image: 'AAAA' }), service)).status).toBe(400);
    expect((await handle(post({ replay: 'A'.repeat(200_000) }), service)).status).toBe(400);
    expect((await handle(post('x'.repeat(2_000_000)), service)).status).toBe(413);
    expect(service.LINKS.data.size).toBe(0);
  });

  it('limits how many links one address creates in an hour', async () => {
    const service = env();
    let status = 0;
    for (let i = 0; i < 31; i++) {
      status = (await handle(post({ replay: base64(encodeReplay(replay({ time: 1000 + i }))) }), service)).status;
    }
    expect(status).toBe(429);
    const other = await handle(post({ replay: base64(encodeReplay(replay())) }, '5.6.7.8'), service);
    expect(other.status).toBe(200);
  });

  it('answers the rest sensibly', async () => {
    const service = env();
    expect((await handle(new Request(`${SERVICE}/api/links`, { method: 'OPTIONS' }), service)).status).toBe(204);
    expect((await handle(new Request(`${SERVICE}/api/links`), service)).status).toBe(405);
    expect((await handle(new Request(`${SERVICE}/r/unknown0000`), service)).status).toBe(404);
    // An unknown or expired link still gets the visitor to the game.
    const missing = await handle(new Request(`${SERVICE}/r/abcdefghij`), service);
    expect([missing.status, missing.headers.get('Location')]).toEqual([302, 'https://game.example/wheelie/']);
    expect((await handle(new Request(`${SERVICE}/i/abcdefghij.png`), service)).status).toBe(404);
    expect((await handle(new Request(`${SERVICE}/nothing`), service)).status).toBe(404);
  });
});
