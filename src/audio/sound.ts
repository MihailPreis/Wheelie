import type { DualSense } from '../game/dualsense';
import { engineLoop, engineSustain } from './engine-sample';
import type { AudioOutput } from './output';

// The original game was silent, so everything here is new: an engine and a few effects, all
// recorded/synthesised, none of them read back by the simulation.

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
  audible: GainNode;
  synth: GainNode;
  sampled: { idle: AudioBufferSourceNode; load: AudioBufferSourceNode; idleGain: GainNode; loadGain: GainNode } | null;
}

export class Sound {
  enabled = true;
  /** Speaker level only: engine haptics keep their independent amplitude. */
  volume = 100;
  private engineNodes: Engine | null = null;
  private noise: AudioBuffer | null = null;

  constructor(
    private readonly output: AudioOutput,
    readonly controller: DualSense,
    private readonly engineUrl: string,
  ) {}

  private hapticsLoading: Promise<void> | null = null;
  private sampleLoading: Promise<void> | null = null;

  private attachSample(context: AudioContext, engine: Engine): void {
    if (this.sampleLoading) return;
    this.sampleLoading = fetch(this.engineUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error('Engine recording unavailable');
        const recording = await context.decodeAudioData(await response.arrayBuffer());
        // Separate steady textures; throttle controls their pitch rather than replaying a rev-up.
        const idle = context.createBufferSource();
        idle.buffer = engineLoop(context, recording, 12, 15.8);
        const load = context.createBufferSource();
        load.buffer = engineSustain(context, recording);
        const idleGain = context.createGain();
        const loadGain = context.createGain();
        idleGain.gain.value = 0;
        loadGain.gain.value = 0;
        idle.loop = load.loop = true;
        idle.connect(idleGain).connect(engine.filter);
        load.connect(loadGain).connect(engine.filter);
        idle.start();
        load.start();
        engine.sampled = { idle, load, idleGain, loadGain };
        engine.synth.gain.setTargetAtTime(0, context.currentTime, ENGINE_GLIDE);
      })
      .catch(() => {
        // The synthesised engine remains usable when a recording cannot be loaded or decoded.
      });
  }

  unlock(): void {
    this.output.unlock();
  }

  private attachHaptics(context: AudioContext, gain: GainNode): void {
    if (!context.audioWorklet || this.hapticsLoading) return;
    this.hapticsLoading = context.audioWorklet
      .addModule(new URL('./haptics-worklet.js', import.meta.url).href)
      .then(() => {
        const tap = new AudioWorkletNode(context, 'engine-haptics', { channelCount: 2, channelCountMode: 'explicit' });
        tap.port.onmessage = (event: MessageEvent<Uint8Array>) => this.controller.pcm(event.data);
        tap.onprocessorerror = () => {
          gain.disconnect(tap);
          tap.disconnect();
          this.hapticsLoading = null;
        };
        gain.connect(tap).connect(context.destination);
      })
      .catch(() => {
        this.hapticsLoading = null;
      });
  }

  /** The context if sound may play right now. */
  private get context(): AudioContext | null {
    return this.enabled ? this.output.context : null;
  }

  /**
   * Follows the bike: `speed` is 0…1 of top speed. Call every frame while riding, and
   * {@link Sound.engineOff} when the bike is not under the player's control.
   */
  engine(speed: number, throttle: number): void {
    this.controller.engine();
    const context = this.enabled || this.controller.pcmAvailable ? this.output.context : null;
    if (!context) {
      if (this.engineNodes && this.output.context)
        this.engineNodes.gain.gain.setTargetAtTime(0, this.output.context.currentTime, ENGINE_GLIDE);
      return;
    }
    const engine = this.engineNodes ?? this.createEngine(context);
    // Retry a worklet that failed to load instead of leaving the engine without feedback.
    this.attachHaptics(context, engine.gain);
    // Opening the throttle raises the revs at once, before the bike has picked up speed.
    const pressure = Math.max(0, Math.min(1, throttle));
    const revs = Math.min(1, speed * 0.2 + pressure * 0.8);
    const hertz = ENGINE_IDLE_HERTZ + (ENGINE_TOP_HERTZ - ENGINE_IDLE_HERTZ) * revs;
    const now = context.currentTime;
    engine.audible.gain.setTargetAtTime(this.enabled ? this.volume / 100 : 0, now, ENGINE_GLIDE);
    engine.oscillators[0]?.frequency.setTargetAtTime(hertz, now, ENGINE_GLIDE);
    engine.oscillators[1]?.frequency.setTargetAtTime(hertz / 2, now, ENGINE_GLIDE);
    if (engine.sampled) {
      const sample = engine.sampled;
      sample.idle.playbackRate.setTargetAtTime(1 + revs * 1.5, now, ENGINE_GLIDE);
      sample.load.playbackRate.setTargetAtTime(0.9 + revs * 0.35, now, ENGINE_GLIDE);
      const mix = Math.min(1, pressure + speed * 0.15 * (1 - pressure));
      sample.idleGain.gain.setTargetAtTime(Math.cos((mix * Math.PI) / 2), now, ENGINE_GLIDE);
      sample.loadGain.gain.setTargetAtTime(Math.sin((mix * Math.PI) / 2), now, ENGINE_GLIDE);
      engine.filter.Q.setTargetAtTime(0.7, now, ENGINE_GLIDE);
      engine.filter.frequency.setTargetAtTime(1800 + 4200 * revs, now, ENGINE_GLIDE);
      engine.gain.gain.setTargetAtTime(0.5 + 0.45 * pressure, now, ENGINE_GLIDE);
    } else {
      engine.filter.frequency.setTargetAtTime(350 + 1400 * revs + pressure * 500, now, ENGINE_GLIDE);
      engine.gain.gain.setTargetAtTime(ENGINE_VOLUME * (0.55 + 0.45 * pressure), now, ENGINE_GLIDE);
    }
  }

  engineOff(): void {
    void this.controller.stop();
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
    const audible = context.createGain();
    audible.gain.value = this.enabled ? this.volume / 100 : 0;
    filter.connect(gain).connect(audible).connect(context.destination);
    this.attachHaptics(context, gain);
    const synth = context.createGain();
    synth.connect(filter);
    // A saw for the bark of the exhaust and a square an octave below for the body.
    const oscillators = (['sawtooth', 'square'] as const).map((type) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = ENGINE_IDLE_HERTZ;
      oscillator.connect(synth);
      oscillator.start();
      return oscillator;
    });
    this.engineNodes = { oscillators, filter, gain, audible, synth, sampled: null };
    this.attachSample(context, this.engineNodes);
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
    if (this.volume === 0) {
      gain.gain.setValueAtTime(0, at);
    } else {
      gain.gain.setValueAtTime(Math.max(0.0001, (level * this.volume) / 100), at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    }
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
