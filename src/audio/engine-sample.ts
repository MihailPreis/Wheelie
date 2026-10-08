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
    let power = 0;
    for (let index = 0; index < length; index++) {
      target[index] = (target[index] as number) - mean;
      power += (target[index] as number) ** 2;
    }
    const gain = Math.min(4, 0.09 / Math.max(0.001, Math.sqrt(power / length)));
    for (let index = 0; index < length; index++) target[index] = (target[index] as number) * gain;
  }
  return loop;
}
