import { SAMPLE_RATE } from './protocol.js';

export function rmsOf(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}

export function concatPcm(parts: Int16Array[]): Int16Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Int16Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Wraps 16-bit mono PCM in a WAV container (the audio is never written to disk). */
export function pcm16ToWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataLen = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, dataLen).copy(buf, 44);
  return buf;
}

/**
 * Energy-based voice activity detector with an adaptive noise floor.
 * The floor is capped so steady background music cannot raise the bar
 * so high that speech over it is never detected.
 */
export class Vad {
  private noise = 0.004;
  isSpeech(rms: number): boolean {
    const threshold = Math.max(0.012, this.noise * 3);
    const speech = rms > threshold;
    if (!speech) this.noise = Math.min(0.03, this.noise * 0.95 + rms * 0.05);
    return speech;
  }
}

/** Runs async jobs one at a time and reports whether one is in flight. */
export class Lane {
  private tail: Promise<unknown> = Promise.resolve();
  private active = 0;
  get busy(): boolean {
    return this.active > 0;
  }
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.active++;
    const p = this.tail.then(fn);
    this.tail = p.catch(() => undefined);
    return p.finally(() => {
      this.active--;
    });
  }
}
