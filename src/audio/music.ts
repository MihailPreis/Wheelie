import type { AudioOutput } from './output';
import { MUSIC_TRACKS, PlaylistOrder, playlistIndices } from './playlist';

const VOLUME = 0.35;
/** Seconds over which the music fades when it is switched on or off. */
const FADE = 0.05;
const CROSSFADE = 0.6;
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  endsAt: number;
  fade: number;
}

/** Local shuffle playlist, with only the current and upcoming tracks decoded in memory. */
export class Music {
  private gain: GainNode | null = null;
  private loading = false;
  private wanted = true;
  private level = 100;
  private generation = 0;
  private readonly voices = new Set<Voice>();
  private mode = 0;
  private order = new PlaylistOrder(playlistIndices(0).length);
  trackIndex = 0;
  onChange: (() => void) | null = null;

  get tracks(): number[] {
    return playlistIndices(this.mode);
  }
  get style(): number {
    return this.mode;
  }
  set style(value: number) {
    if (value === this.mode || ![0, 1, 2].includes(value)) return;
    this.mode = value;
    this.order = new PlaylistOrder(this.tracks.length);
    this.select(this.tracks.includes(this.trackIndex) ? this.trackIndex : (this.tracks[0] as number));
  }

  constructor(
    private readonly output: AudioOutput,
    private readonly baseUrl: string,
  ) {}

  get enabled(): boolean {
    return this.wanted;
  }

  set enabled(enabled: boolean) {
    this.wanted = enabled;
    this.apply();
    if (enabled && this.output.context) this.unlock();
  }

  get volume(): number {
    return this.level;
  }
  set volume(value: number) {
    this.level = Math.max(0, Math.min(100, value));
    this.apply();
  }

  /** Call from a user input event; starts the music the first time, if it is enabled. */
  unlock(): void {
    const context = this.output.unlock();
    if (!context || !this.wanted || this.voices.size || this.loading) return;
    if (!this.gain) {
      this.gain = context.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(context.destination);
    }
    this.apply();
    this.loading = true;
    const generation = this.generation;
    void this.decode(context, this.trackIndex)
      .then((buffer) => {
        if (generation !== this.generation) return;
        const voice = this.voice(context, buffer, context.currentTime);
        void this.prepare(context, voice, this.trackIndex, generation);
      })
      .catch((error) => console.warn('Music is unavailable:', error))
      .finally(() => {
        if (generation === this.generation) this.loading = false;
      });
  }

  select(index: number): void {
    if (!MUSIC_TRACKS[index]) return;
    this.generation++;
    this.loading = false;
    this.trackIndex = index;
    this.order.reset();
    for (const voice of this.voices) {
      voice.source.onended = null;
      voice.source.stop();
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
    this.onChange?.();
    this.unlock();
  }

  private async decode(context: AudioContext, index: number): Promise<AudioBuffer> {
    const url = `${this.baseUrl}${MUSIC_TRACKS[index]?.file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    return context.decodeAudioData(await response.arrayBuffer());
  }

  private voice(context: AudioContext, buffer: AudioBuffer, at: number): Voice {
    const source = context.createBufferSource();
    const gain = context.createGain();
    const fade = Math.min(CROSSFADE, buffer.duration / 4);
    const endsAt = at + buffer.duration;
    source.buffer = buffer;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + fade);
    gain.gain.setValueAtTime(1, endsAt - fade);
    gain.gain.linearRampToValueAtTime(0, endsAt);
    source.connect(gain).connect(this.gain as GainNode);
    const voice = { source, gain, endsAt, fade };
    this.voices.add(voice);
    source.onended = () => this.release(voice);
    source.start(at);
    return voice;
  }

  private release(voice: Voice): void {
    this.voices.delete(voice);
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  private async prepare(context: AudioContext, current: Voice, index: number, generation: number): Promise<void> {
    let next = index;
    for (let tries = 0; tries < MUSIC_TRACKS.length; tries++) {
      const indices = this.tracks;
      next = indices[this.order.next(indices.indexOf(next))] as number;
      try {
        const buffer = await this.decode(context, next);
        if (generation !== this.generation) return;
        const voice = this.voice(context, buffer, Math.max(context.currentTime, current.endsAt - current.fade));
        const advance = () => {
          this.release(current);
          if (generation !== this.generation) return;
          this.trackIndex = next;
          this.onChange?.();
          void this.prepare(context, voice, next, generation);
        };
        if (context.currentTime >= current.endsAt) advance();
        else current.source.onended = advance;
        return;
      } catch (error) {
        if (generation !== this.generation) return;
        console.warn('Skipping unavailable music:', error);
      }
    }
  }

  private apply(): void {
    const context = this.output.context;
    if (!context || !this.gain) return;
    this.gain.gain.setTargetAtTime(this.wanted ? (VOLUME * this.level) / 100 : 0, context.currentTime, FADE);
  }
}
