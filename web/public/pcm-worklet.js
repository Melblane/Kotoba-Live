// Runs on the audio thread. Mixes to mono, downsamples to 16 kHz with a box filter,
// and posts 100 ms frames of 16-bit PCM plus their RMS level to the main thread.
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1600;

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // input samples per output sample
    this.phase = 0;
    this.acc = 0;
    this.count = 0;
    this.out = new Int16Array(FRAME_SAMPLES);
    this.outLen = 0;
    this.sumSq = 0;
    this.mono = new Float32Array(128);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const n = input[0].length;
    if (this.mono.length !== n) this.mono = new Float32Array(n);
    const mono = this.mono;

    if (input.length === 1) {
      mono.set(input[0]);
    } else {
      mono.fill(0);
      for (let c = 0; c < input.length; c++) {
        const ch = input[c];
        for (let i = 0; i < n; i++) mono[i] += ch[i] / input.length;
      }
    }

    for (let i = 0; i < n; i++) {
      this.acc += mono[i];
      this.count++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.count));
        this.acc = 0;
        this.count = 0;
        this.sumSq += v * v;
        this.out[this.outLen++] = v < 0 ? v * 32768 : v * 32767;
        if (this.outLen === FRAME_SAMPLES) {
          const buffer = this.out.buffer;
          this.port.postMessage({ pcm: buffer, rms: Math.sqrt(this.sumSq / FRAME_SAMPLES) }, [buffer]);
          this.out = new Int16Array(FRAME_SAMPLES);
          this.outLen = 0;
          this.sumSq = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
