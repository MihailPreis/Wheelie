import type { AudioOutput } from './output';

// The original game was silent, so everything here is new: an engine and a few effects, all
// synthesised, none of them read back by the simulation.

const ENGINE_IDLE_HERTZ = 48;
const ENGINE_TOP_HERTZ = 170;
const ENGINE_VOLUME = 0.09;
const EFFECT_VOLUME = 0.16;
/** Seconds the engine takes to follow a change; long enough to hide the steps between frames. */
const ENGINE_GLIDE = 0.06;

/** Note frequencies of the finish jingle: C5 E5 G5 C6, and two more for a clean wheelie. */
const FINISH_NOTES = [523.25, 659.25, 783.99, 1046.5];
const WHEELIE_NOTES = [...FINISH_NOTES, 1318.5, 1568];

interface Engine {
  oscillators: OscillatorNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class Sound {
  enabled = true;
  private engineNodes: Engine | null = null;
  private noise: AudioBuffer | null = null;

  constructor(private readonly output: AudioOutput) {}

  /** The context if sound may play right now. */
  private get context(): AudioContext | null {
    return this.enabled ? this.output.context : null;
  }

  /**
   * Follows the bike: `speed` is 0…1 of top speed. Call every frame while riding, and
   * {@link Sound.engineOff} when the bike is not under the player's control.
   */
  engine(speed: number, throttle: boolean): void {
    const context = this.context;
    if (!context) {
      this.engineOff();
      return;
    }
    const engine = this.engineNodes ?? this.createEngine(context);
    // Opening the throttle raises the revs at once, before the bike has picked up speed.
    const revs = Math.min(1, speed * 0.85 + (throttle ? 0.15 : 0));
    const hertz = ENGINE_IDLE_HERTZ + (ENGINE_TOP_HERTZ - ENGINE_IDLE_HERTZ) * revs;
    const now = context.currentTime;
    engine.oscillators[0]?.frequency.setTargetAtTime(hertz, now, ENGINE_GLIDE);
    engine.oscillators[1]?.frequency.setTargetAtTime(hertz / 2, now, ENGINE_GLIDE);
    engine.filter.frequency.setTargetAtTime(350 + 1400 * revs + (throttle ? 500 : 0), now, ENGINE_GLIDE);
    engine.gain.gain.setTargetAtTime(ENGINE_VOLUME * (throttle ? 1 : 0.55), now, ENGINE_GLIDE);
  }

  engineOff(): void {
    const context = this.output.context;
    if (!context || !this.engineNodes) return;
    this.engineNodes.gain.gain.setTargetAtTime(0, context.currentTime, ENGINE_GLIDE);
  }

  private createEngine(context: AudioContext): Engine {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    const gain = context.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(context.destination);
    // A saw for the bark of the exhaust and a square an octave below for the body.
    const oscillators = (['sawtooth', 'square'] as const).map((type) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = ENGINE_IDLE_HERTZ;
      oscillator.connect(filter);
      oscillator.start();
      return oscillator;
    });
    this.engineNodes = { oscillators, filter, gain };
    return this.engineNodes;
  }

  /** The rider is down or the bike has come apart. */
  crash(): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.4);
    source.connect(filter).connect(this.envelope(context, now, 0.4, EFFECT_VOLUME * 1.5));
    source.start(now);
    source.stop(now + 0.45);

    const thump = context.createOscillator();
    thump.frequency.setValueAtTime(140, now);
    thump.frequency.exponentialRampToValueAtTime(40, now + 0.25);
    thump.connect(this.envelope(context, now, 0.3, EFFECT_VOLUME * 2));
    thump.start(now);
    thump.stop(now + 0.35);
  }

  finish(wheelie: boolean): void {
    const context = this.context;
    if (!context) return;
    const notes = wheelie ? WHEELIE_NOTES : FINISH_NOTES;
    notes.forEach((hertz, index) => {
      const last = index === notes.length - 1;
      this.beep(context, hertz, context.currentTime + index * 0.09, last ? 0.35 : 0.09);
    });
  }

  /** Moving the highlight in a menu. */
  menuMove(): void {
    const context = this.context;
    if (context) this.beep(context, 440, context.currentTime, 0.03, 0.5);
  }

  /** Choosing a menu item or going back. */
  menuSelect(): void {
    const context = this.context;
    if (context) this.beep(context, 660, context.currentTime, 0.06, 0.6);
  }

  private beep(context: AudioContext, hertz: number, at: number, seconds: number, level = 1): void {
    const oscillator = context.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.value = hertz;
    oscillator.connect(this.envelope(context, at, seconds, EFFECT_VOLUME * 0.5 * level));
    oscillator.start(at);
    oscillator.stop(at + seconds + 0.05);
  }

  /** A gain that starts at `level` and dies away over `seconds`, already connected to the output. */
  private envelope(context: AudioContext, at: number, seconds: number, level: number): GainNode {
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    gain.connect(context.destination);
    return gain;
  }

  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const buffer = context.createBuffer(1, context.sampleRate / 2, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }
}
