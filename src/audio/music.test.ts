import { afterEach, describe, expect, it, vi } from 'vitest';
import { Music } from './music';
import type { AudioOutput } from './output';

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function environment() {
  const gains: { gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }[] = [];
  const sources: { onended: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] =
    [];
  const context = {
    currentTime: 0,
    destination: {},
    decodeAudioData: vi.fn(async () => ({ duration: 10 })),
    createGain: () => {
      const node = {
        gain: { value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: (_other: unknown) => node,
        disconnect: vi.fn(),
      };
      gains.push(node);
      return node;
    },
    createBufferSource: () => {
      const node = {
        buffer: null,
        onended: null,
        start: vi.fn(),
        stop: vi.fn(),
        connect: (other: unknown) => other,
        disconnect: vi.fn(),
      };
      sources.push(node);
      return node;
    },
  };
  const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  vi.stubGlobal('fetch', fetcher);
  const output = { context, unlock: () => context } as unknown as AudioOutput;
  return { music: new Music(output, '/audio/'), context, sources, gains, fetcher };
}
afterEach(() => vi.unstubAllGlobals());

describe('music playback', () => {
  it('preloads one track and schedules crossfades on the audio clock', async () => {
    const { music, sources, context, fetcher } = environment();
    music.unlock();
    await flush();
    expect(sources).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sources[1]?.start).toHaveBeenCalledWith(9.4);
    context.currentTime = 10;
    sources[0]?.onended?.();
    await flush();
    expect(sources).toHaveLength(3);
    expect(sources[2]?.start.mock.calls[0]?.[0]).toBeCloseTo(18.8, 8);
    expect(music.trackIndex).not.toBe(0);
  });

  it('changes speaker level, mutes and replaces scheduled tracks without overlapping old playback', async () => {
    const { music, sources, gains } = environment();
    music.unlock();
    await flush();
    music.volume = 50;
    expect(gains[0]?.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.175, 0, 0.05);
    music.enabled = false;
    expect(gains[0]?.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.05);
    music.select(2);
    expect(sources[0]?.stop).toHaveBeenCalledOnce();
    expect(sources[1]?.stop).toHaveBeenCalledOnce();
    expect(sources).toHaveLength(2);
    music.enabled = true;
    await flush();
    expect(sources).toHaveLength(4);
    expect(music.trackIndex).toBe(2);
  });
});
