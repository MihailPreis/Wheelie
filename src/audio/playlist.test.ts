import { describe, expect, it } from 'vitest';
import { MUSIC_CREDITS, MUSIC_TRACKS, PlaylistOrder, playlistIndices } from './playlist';

describe('music shuffle order', () => {
  it('visits each other track before repeating and never repeats adjacent tracks', () => {
    const order = new PlaylistOrder(6, () => 0.5);
    let current = 0;
    const first = [];
    for (let i = 0; i < 5; i++) {
      current = order.next(current);
      first.push(current);
    }
    expect(new Set([0, ...first]).size).toBe(6);
    for (let i = 0; i < 100; i++) {
      const next = order.next(current);
      expect(next).not.toBe(current);
      current = next;
    }
  });

  it('credits every bundled track with its source', () => {
    for (const track of MUSIC_TRACKS) {
      expect(MUSIC_CREDITS).toContain(track.title);
      expect(MUSIC_CREDITS).toContain(track.source);
      expect(MUSIC_CREDITS).toContain(track.license);
    }
  });

  it('keeps driving playback separate from funk tracks', () => {
    expect(playlistIndices(0).length).toBe(2);
    expect(playlistIndices(0).every((index) => MUSIC_TRACKS[index]?.genre === 'driving')).toBe(true);
    expect(playlistIndices(1).every((index) => MUSIC_TRACKS[index]?.genre === 'funk')).toBe(true);
    expect(playlistIndices(2)).toHaveLength(MUSIC_TRACKS.length);
  });
});
