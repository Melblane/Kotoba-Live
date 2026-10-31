import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

interface Frame { pcm: Int16Array; rms: number }

/** Loads public/pcm-worklet.js inside a sandbox that mimics the AudioWorkletGlobalScope. */
function loadProcessor(rate: number) {
  const frames: Frame[] = [];
  let Ctor: new () => { process(inputs: Float32Array[][]): boolean; port: { postMessage(m: { pcm: ArrayBuffer; rms: number }): void } };
  class AudioWorkletProcessor {
    port = { postMessage: (m: { pcm: ArrayBuffer; rms: number }) => frames.push({ pcm: new Int16Array(m.pcm), rms: m.rms }) };
  }
  const sandbox = {
    sampleRate: rate,
    AudioWorkletProcessor,
    registerProcessor: (_name: string, c: typeof Ctor) => (Ctor = c),
    Math, Int16Array, Float32Array,
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8'), sandbox);
  return { proc: new Ctor!(), frames };
}

function feed(proc: ReturnType<typeof loadProcessor>['proc'], rate: number, seconds: number, hz: number, amp: number, channels = 1) {
  const total = Math.floor(rate * seconds);
  for (let start = 0; start < total; start += 128) {
    const block = Array.from({ length: channels }, () => new Float32Array(128));
    for (let i = 0; i < 128; i++) for (const ch of block) ch[i] = Math.sin((2 * Math.PI * hz * (start + i)) / rate) * amp;
    assert.equal(proc.process([block]), true);
  }
}

function zeroCrossingHz(pcm: Int16Array, rate: number): number {
  let crossings = 0;
  for (let i = 1; i < pcm.length; i++) if (pcm[i - 1] < 0 !== pcm[i] < 0) crossings++;
  return crossings / 2 / (pcm.length / rate);
}

for (const rate of [48_000, 44_100, 16_000]) {
  test(`worklet at ${rate} Hz emits 100 ms frames of 16 kHz PCM with the right pitch and level`, () => {
    const { proc, frames } = loadProcessor(rate);
    feed(proc, rate, 1.0, 440, 0.5);
    assert.ok(frames.length >= 9 && frames.length <= 10, `expected about 10 frames, got ${frames.length}`);
    for (const f of frames) assert.equal(f.pcm.length, 1600);
    const mid = frames[5];
    const hz = zeroCrossingHz(mid.pcm, 16_000);
    assert.ok(Math.abs(hz - 440) < 15, `pitch should survive resampling, got ${hz.toFixed(1)} Hz`);
    // A 0.5 amplitude sine has RMS of about 0.354; the box filter attenuates highs only slightly.
    assert.ok(mid.rms > 0.3 && mid.rms < 0.38, `rms ${mid.rms}`);
    const peak = Math.max(...Array.from(mid.pcm, Math.abs));
    assert.ok(peak > 14_000 && peak < 17_000, `peak ${peak}`);
  });
}

test('stereo input is mixed down to mono and silence produces zero level', () => {
  const stereo = loadProcessor(48_000);
  feed(stereo.proc, 48_000, 0.5, 440, 0.5, 2);
  assert.ok(stereo.frames[2].rms > 0.3);

  const quiet = loadProcessor(48_000);
  feed(quiet.proc, 48_000, 0.5, 440, 0);
  assert.ok(quiet.frames.every((f) => f.rms === 0));
});

test('frames can be fed continuously without drift: 10 s of audio gives about 100 frames', () => {
  const { proc, frames } = loadProcessor(48_000);
  feed(proc, 48_000, 10, 300, 0.3);
  assert.ok(frames.length >= 99 && frames.length <= 100, `got ${frames.length}`);
});
