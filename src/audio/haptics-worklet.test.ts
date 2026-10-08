import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('downsamples stereo engine audio to 3 kHz without mixing its channels', () => {
  const packets: Uint8Array[] = [];
  let processor!: { process(inputs: Float32Array[][]): boolean };
  runInNewContext(readFileSync(new URL('./haptics-worklet.js', import.meta.url), 'utf8'), {
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port = { postMessage: (block: Uint8Array) => packets.push(block) };
    },
    registerProcessor: (_name: string, Processor: new () => typeof processor) => {
      processor = new Processor();
    },
  });
  for (let index = 0; index < 375; index++) {
    expect(processor.process([[new Float32Array(128).fill(0.1), new Float32Array(128).fill(-0.1)]])).toBe(true);
  }
  expect(packets).toHaveLength(93); // 3000 stereo samples, with a partial block retained.
  for (const packet of packets) {
    expect(packet.length).toBe(64);
    for (let index = 0; index < 64; index += 2) {
      expect(packet[index]).toBeGreaterThan(0);
      expect(packet[index]).toBeLessThan(128);
      expect(packet[index + 1]).toBeGreaterThan(128);
    }
  }
});
