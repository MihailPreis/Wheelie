import type { AudioOutput } from './output';

const VOLUME = 0.35;
/** Seconds over which the music fades when it is switched on or off. */
const FADE = 0.05;

/** Background music: one track, looped without a gap. */
export class Music {
  private gain: GainNode | null = null;
  private loading = false;
  private wanted = true;

  constructor(
    private readonly output: AudioOutput,
    private readonly url: string,
  ) {}

  get enabled(): boolean {
    return this.wanted;
  }

  set enabled(enabled: boolean) {
    this.wanted = enabled;
    this.apply();
  }

  /** Call from a user input event; starts the music the first time, if it is enabled. */
  unlock(): void {
    const context = this.output.unlock();
    if (!context || !this.wanted || this.gain || this.loading) return;
    this.loading = true;
    this.load(context).catch((error) => {
      // The game is fully playable without music.
      console.warn('Music is unavailable:', error);
    });
  }

  private async load(context: AudioContext): Promise<void> {
    const response = await fetch(this.url);
    if (!response.ok) throw new Error(`Failed to load ${this.url}`);
    // Decoded audio in a looping buffer source repeats sample-exactly, unlike an <audio> element.
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(context.destination);
    source.start();
    this.gain = gain;
    this.apply();
  }

  private apply(): void {
    const context = this.output.context;
    if (!context || !this.gain) return;
    this.gain.gain.setTargetAtTime(this.wanted ? VOLUME : 0, context.currentTime, FADE);
  }
}
