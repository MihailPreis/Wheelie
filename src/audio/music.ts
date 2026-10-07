/**
 * Background music: one track, looped without a gap.
 *
 * Browsers only allow sound after the player has interacted with the page, so nothing plays until
 * {@link Music.unlock} is called from an input event.
 */

const STORAGE_KEY = 'wheelie.music';
const VOLUME = 0.35;

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage can be unavailable (private mode, embedded frames); the choice then lasts for the session.
  }
}

export class Music {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private loading = false;
  private wanted: boolean = readPreference();
  /** The page is hidden, so nothing should be audible whatever the setting. */
  private hidden = false;

  constructor(private readonly url: string) {}

  get enabled(): boolean {
    return this.wanted;
  }

  set enabled(enabled: boolean) {
    this.wanted = enabled;
    writePreference(enabled);
    this.apply();
  }

  /** Call from a user input event; starts the music the first time, if it is enabled. */
  unlock(): void {
    if (!this.wanted || this.context || this.loading) {
      this.apply();
      return;
    }
    this.loading = true;
    this.load().catch((error) => {
      // The game is fully playable without music.
      console.warn('Music is unavailable:', error);
    });
  }

  private async load(): Promise<void> {
    const context = new AudioContext();
    const response = await fetch(this.url);
    if (!response.ok) throw new Error(`Failed to load ${this.url}`);
    // Decoded audio in a looping buffer source repeats sample-exactly, unlike an <audio> element.
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = VOLUME;
    source.connect(gain).connect(context.destination);
    source.start();
    this.context = context;
    this.gain = gain;
    this.apply();
  }

  /** Silences the music while the page is in the background. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.apply();
  }

  private apply(): void {
    const context = this.context;
    if (!context) return;
    const audible = this.wanted && !this.hidden;
    if (audible && context.state === 'suspended') void context.resume();
    else if (!audible && context.state === 'running') void context.suspend();
  }
}
