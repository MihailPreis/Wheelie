import { describe, expect, it } from 'vitest';
import { engineSustain, stabiliseEngineLevel } from './engine-sample';

function buffer(channels: Float32Array[], rate: number): AudioBuffer {
  return {
    length: channels[0]?.length ?? 0,
    sampleRate: rate,
    duration: (channels[0]?.length ?? 0) / rate,
    numberOfChannels: channels.length,
    getChannelData: (index: number) => channels[index],
  } as AudioBuffer;
}
function variation(samples: Float32Array): number {
  const values = [];
  for (let from = 0; from < samples.length; from += 400) {
    let power = 0;
    for (let i = from; i < from + 400; i++) power += (samples[i] as number) ** 2;
    values.push(Math.sqrt(power / 400));
  }
  return Math.max(...values) / Math.min(...values);
}

describe('sustained engine texture', () => {
  it('extends a rev without repeating a short hit and preserves stereo phase', () => {
    const rate = 2000;
    const samples = Float32Array.from({ length: rate * 42 }, (_, i) => {
      const time = i / rate;
      return Math.sin(2 * Math.PI * (61 * time + 0.3 * Math.sin(time * 29))) * 0.08;
    });
    const source = buffer([samples, Float32Array.from(samples, (value) => value / 2)], rate);
    const context = {
      createBuffer: (channels: number, length: number, sampleRate: number) =>
        buffer(
          Array.from({ length: channels }, () => new Float32Array(length)),
          sampleRate,
        ),
    } as BaseAudioContext;
    const loop = engineSustain(context, source);
    expect(loop.duration).toBeCloseTo(8);
    const left = loop.getChannelData(0);
    const right = loop.getChannelData(1);
    expect(left.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < left.length; i++) expect(right[i]).toBeCloseTo((left[i] as number) / 2, 5);
    let difference = 0;
    const shortRepeat = Math.round(rate * 0.28);
    for (let i = shortRepeat; i < left.length; i++)
      difference += ((left[i] as number) - (left[i - shortRepeat] as number)) ** 2;
    expect(difference / left.length).toBeGreaterThan(0.001);
  });

  it('removes slow volume swells while retaining the carrier and stereo relationship', () => {
    const left = Float32Array.from(
      { length: 8000 },
      (_, i) => (0.1 + 0.02 * Math.sin((4 * Math.PI * i) / 8000)) * Math.sin((2 * Math.PI * 1000 * i) / 8000),
    );
    const right = Float32Array.from(left, (value) => value / 2);
    const original = left.slice();
    const before = variation(left);
    stabiliseEngineLevel(buffer([left, right], 8000));
    expect(variation(left)).toBeLessThan(before);
    expect(variation(left)).toBeLessThan(1.05);
    for (let i = 0; i < left.length; i++) {
      expect(Math.sign(left[i] as number)).toBe(Math.sign(original[i] as number));
      expect(right[i]).toBeCloseTo((left[i] as number) / 2, 7);
    }
  });

  it('keeps silent buffers finite', () => {
    const samples = new Float32Array(8000);
    stabiliseEngineLevel(buffer([samples], 8000));
    expect(samples.every((value) => value === 0)).toBe(true);
  });
});
