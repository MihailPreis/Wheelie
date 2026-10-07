import { describe, expect, it } from 'vitest';
import { MAX_REPLAY_BYTES } from '../formats/replay';
import { decodeFragment, encodeLink, isReplayFragment } from './share';

const fragmentOf = (link: string) => link.slice(link.indexOf('#'));

describe('replay links', () => {
  it('round-trip the bytes of a replay', async () => {
    const bytes = Uint8Array.from({ length: 3000 }, (_, index) => (index * 7) % 13);
    const link = await encodeLink('https://example.org/game/', bytes);
    expect(link.startsWith('https://example.org/game/#r=')).toBe(true);
    expect(isReplayFragment(fragmentOf(link))).toBe(true);
    expect(await decodeFragment(fragmentOf(link))).toEqual(bytes);
    // Repetitive data, as inputs are, packs well.
    expect(link.length).toBeLessThan(400);
  });

  it('keep data that does not pack as it is', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const link = await encodeLink('https://example.org/', bytes);
    expect(fragmentOf(link)).toBe('#r=pAQID');
    expect(await decodeFragment('#r=pAQID')).toEqual(bytes);
  });

  it('replace a fragment the base address already has', async () => {
    expect(await encodeLink('https://example.org/#old', Uint8Array.from([1]))).toBe('https://example.org/#r=pAQ');
  });

  it('reject what is not a replay link', async () => {
    await expect(decodeFragment('#other')).rejects.toThrow();
    await expect(decodeFragment('#r=x1234')).rejects.toThrow();
    await expect(decodeFragment('#r=p***')).rejects.toThrow();
    await expect(decodeFragment('#r=dAAAA')).rejects.toThrow();
  });

  it('refuse data that unpacks beyond the size of a replay', async () => {
    const huge = new Uint8Array(MAX_REPLAY_BYTES + 1);
    const packed = new Uint8Array(
      await new Response(new Blob([huge]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
    );
    expect(packed.length).toBeLessThan(10_000);
    const text = btoa(String.fromCharCode(...packed))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    await expect(decodeFragment(`#r=d${text}`)).rejects.toThrow(/more than a replay/);
  });
});
