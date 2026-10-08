/** Low-pass and downsample engine audio to 3 kHz stereo signed 8-bit PCM. */
class EngineHaptics extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.filtered = [0, 0];
    this.block = new Uint8Array(64);
    this.offset = 0;
    this.alpha = 1 - Math.exp((-2 * Math.PI * 500) / sampleRate);
  }

  process(inputs) {
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    if (!left) return true;
    for (let index = 0; index < left.length; index++) {
      this.filtered[0] += this.alpha * (left[index] - this.filtered[0]);
      this.filtered[1] += this.alpha * (right[index] - this.filtered[1]);
      this.phase += 3000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      for (const value of this.filtered) {
        const sample = Math.round(Math.max(-1, Math.min(1, value * 4)) * 127);
        this.block[this.offset++] = sample & 255;
      }
      if (this.offset === 64) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Uint8Array(64);
        this.offset = 0;
      }
    }
    // The worklet's output is silence: this branch only feeds the controller.
    return true;
  }
}
registerProcessor('engine-haptics', EngineHaptics);
