export interface MusicTrack {
  title: string;
  artist: string;
  file: string;
  source: string;
  genre: 'driving' | 'funk';
  license: 'CC0 1.0' | 'CC BY 4.0';
}

/** Instrumental bass-and-drums shortlist; original recordings, credited in About. */
export const MUSIC_TRACKS: readonly MusicTrack[] = [
  {
    title: 'Rocket Power',
    artist: 'Kevin MacLeod (incompetech.com)',
    file: 'rocket-power.mp3',
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600038',
    genre: 'driving',
    license: 'CC BY 4.0',
  },
  {
    title: 'Cut and Run',
    artist: 'Kevin MacLeod (incompetech.com)',
    file: 'cut-and-run.mp3',
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100851',
    genre: 'driving',
    license: 'CC BY 4.0',
  },
  {
    title: 'Funky Chunk',
    artist: 'Kevin MacLeod (incompetech.com)',
    file: 'funky-chunk.mp3',
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500054',
    genre: 'funk',
    license: 'CC BY 4.0',
  },
];

export const MUSIC_CREDITS = MUSIC_TRACKS.map(
  (track) =>
    `<a href="${track.source}" target="_blank" rel="noopener noreferrer">${track.title}</a> — ${track.artist} ` +
    `(<a href="${track.license === 'CC0 1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/licenses/by/4.0/'}" target="_blank" rel="noopener noreferrer">${track.license}</a>)`,
).join('<br>');

/** 0 driving, 1 funk, 2 all. Keep selection and automatic playback in the same genre. */
export function playlistIndices(style: number): number[] {
  return MUSIC_TRACKS.flatMap((track, index) =>
    style === 2 || track.genre === (style === 0 ? 'driving' : 'funk') ? [index] : [],
  );
}

/** A shuffle bag: play each other track before repeating, without adjacent duplicates. */
export class PlaylistOrder {
  private remaining: number[] = [];
  constructor(
    private readonly length: number,
    private readonly random = Math.random,
  ) {}
  reset(): void {
    this.remaining = [];
  }
  next(current: number): number {
    if (this.length < 2) return 0;
    if (!this.remaining.length) {
      this.remaining = Array.from({ length: this.length }, (_, index) => index).filter((index) => index !== current);
      for (let i = this.remaining.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.remaining[i], this.remaining[j]] = [this.remaining[j] as number, this.remaining[i] as number];
      }
    }
    return this.remaining.shift() as number;
  }
}
