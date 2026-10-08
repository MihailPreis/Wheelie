/** A loop trimmed from a recording, with DC removed and its join crossfaded. */
export function engineLoop(
  context: BaseAudioContext,
  recording: AudioBuffer,
  from: number,
  to: number,
  crossfade = 0.1,
): AudioBuffer {
  const rate = recording.sampleRate;
  const begin = Math.round(from * rate);
  const end = Math.min(recording.length, Math.round(to * rate));
  const fade = Math.max(2, Math.min(Math.round(rate * crossfade), Math.floor((end - begin) / 4)));
  if (end - begin < rate / 4) throw new Error('Engine sample is too short');
  const length = end - begin - fade;
  const loop = context.createBuffer(recording.numberOfChannels, length, rate);
  let power = 0;
  for (let channel = 0; channel < recording.numberOfChannels; channel++) {
    const source = recording.getChannelData(channel);
    const target = loop.getChannelData(channel);
    target.set(source.subarray(begin + fade, end - fade));
    for (let index = 0; index < fade; index++) {
      // Equal-power overlap avoids a volume dip between different engine cycles.
      // Ease the phase so both ends enter the untouched recording smoothly.
      const blend = index / (fade - 1);
      const phase = ((1 - Math.cos(blend * Math.PI)) * Math.PI) / 4;
      target[length - fade + index] =
        (source[end - fade + index] as number) * Math.cos(phase) + (source[begin + index] as number) * Math.sin(phase);
    }
    let sum = 0;
    for (const value of target) sum += value;
    const mean = sum / length;
    for (let index = 0; index < length; index++) {
      target[index] = (target[index] as number) - mean;
      power += (target[index] as number) ** 2;
    }
  }
  // A shared gain preserves the original stereo balance as well as its phase.
  const gain = Math.min(4, 0.09 / Math.max(0.001, Math.sqrt(power / (length * recording.numberOfChannels))));
  for (let channel = 0; channel < recording.numberOfChannels; channel++) {
    const target = loop.getChannelData(channel);
    for (let index = 0; index < length; index++) target[index] = (target[index] as number) * gain;
  }
  return loop;
}

/** Extend the steady rev into a long stereo texture, rather than repeating a single exhaust hit. */
export function engineSustain(context: BaseAudioContext, recording: AudioBuffer): AudioBuffer {
  const rate = recording.sampleRate;
  const begin = Math.round(40 * rate);
  const end = Math.min(recording.length, Math.round(40.9 * rate));
  const grain = Math.round(0.24 * rate);
  const overlap = Math.round(0.08 * rate);
  const hop = grain - overlap;
  if (end - begin < grain) throw new Error('Engine recording has no sustained rev');
  const extended = context.createBuffer(recording.numberOfChannels, Math.round(8.2 * rate), rate);
  const sources = Array.from({ length: recording.numberOfChannels }, (_, ch) => recording.getChannelData(ch));
  const targets = Array.from({ length: recording.numberOfChannels }, (_, ch) => extended.getChannelData(ch));
  // Deterministic scattered excerpts. Match exhaust phase at each overlap in both channels,
  // then use complementary fades: equal-power fades boost correlated engine cycles.
  let seed = 1979;
  for (let at = 0; at < extended.length; at += hop) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const preferred = begin + Math.floor((seed / 0x100000000) * (end - begin - grain));
    let start = preferred;
    if (at > 0) {
      let best = -Infinity;
      const radius = Math.round(0.018 * rate);
      const step = Math.max(1, Math.round(rate / 6000));
      for (
        let candidate = Math.max(begin, preferred - radius);
        candidate <= Math.min(end - grain, preferred + radius);
        candidate += step
      ) {
        let correlation = 0;
        let power = 0;
        for (let i = 0; i < overlap && at + i < extended.length; i += step) {
          for (let ch = 0; ch < sources.length; ch++) {
            const value = sources[ch]?.[candidate + i] as number;
            correlation += value * (targets[ch]?.[at + i] as number);
            power += value * value;
          }
        }
        const score = correlation / Math.sqrt(Math.max(1e-12, power));
        if (score > best) {
          best = score;
          start = candidate;
        }
      }
    }
    for (let ch = 0; ch < sources.length; ch++) {
      const source = sources[ch] as Float32Array;
      const target = targets[ch] as Float32Array;
      for (let i = 0; i < grain && at + i < extended.length; i++) {
        const blend = at > 0 && i < overlap ? (1 - Math.cos((Math.PI * i) / (overlap - 1))) / 2 : 1;
        target[at + i] = (target[at + i] as number) * (1 - blend) + (source[start + i] as number) * blend;
      }
    }
  }
  const loop = engineLoop(context, extended, 0, extended.duration, 0.2);
  stabiliseEngineLevel(loop);
  return loop;
}

/** One shared stereo envelope, measured cyclically so correction itself has no loop seam. */
export function stabiliseEngineLevel(loop: AudioBuffer): void {
  const length = loop.length;
  const channels = Array.from({ length: loop.numberOfChannels }, (_, channel) => loop.getChannelData(channel));
  const power = new Float64Array(length);
  let total = 0;
  for (let i = 0; i < length; i++) {
    for (const channel of channels) power[i] = (power[i] as number) + (channel[i] as number) ** 2 / channels.length;
    total += power[i] as number;
  }
  if (total < 1e-12) return;
  const half = Math.min(Math.floor(length / 4), Math.round(loop.sampleRate * 0.04));
  const window = half * 2 + 1;
  const target = total / length;
  let sum = 0;
  for (let i = -half; i <= half; i++) sum += power[(i + length) % length] as number;
  for (let i = 0; i < length; i++) {
    const gain = Math.max(0.6, Math.min(1.8, Math.sqrt(target / Math.max(1e-12, sum / window))));
    for (const channel of channels) channel[i] = (channel[i] as number) * gain;
    sum += (power[(i + half + 1) % length] as number) - (power[(i - half + length) % length] as number);
  }
}
