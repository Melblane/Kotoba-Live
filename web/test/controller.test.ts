import assert from 'node:assert/strict';
import test from 'node:test';
import { health, liveTimers } from './env.js';

// ---- fakes: a capture that records how it is used, and a WebSocket the "server" can drive ----

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; wasClean: boolean }) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  get json() {
    return this.sent.filter((s): s is string => typeof s === 'string').map((s) => JSON.parse(s));
  }
  get frames() {
    return this.sent.filter((s) => typeof s !== 'string').length;
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    if (typeof data !== 'string') return;
    const msg = JSON.parse(data);
    if (msg.type === 'start') {
      queueMicrotask(() => this.emit({ type: 'ready', stt: { configured: true, model: 'whisper-1', streaming: false, interim: 'rerun' }, translate: { configured: true, model: 'gpt-4o-mini' } }));
    }
    if (msg.type === 'stop') queueMicrotask(() => this.emit({ type: 'stopped' }));
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, wasClean: true });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, wasClean: false });
  }
}
(globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;

Object.assign(health.stt, { configured: true });
Object.assign(health.translate, { configured: true });

const { AudioCapture } = await import('../src/lib/capture.js');
const { TranslatorController } = await import('../src/lib/controller.js');
const { DEFAULT_SETTINGS } = await import('../src/lib/settings.js');

interface FakeCapture {
  info: { surface: 'browser'; hasAudio: true };
  stopped: number;
  stop(): void;
}
let captures: FakeCapture[] = [];
let events: { onFrame(b: ArrayBuffer): void; onLevel(r: number): void; onEnded(c: unknown): void } | null = null;
(AudioCapture as unknown as { isSupported: () => boolean }).isSupported = () => true;
(AudioCapture as unknown as { open: (e: typeof events) => Promise<FakeCapture> }).open = async (e) => {
  events = e;
  const c: FakeCapture = { info: { surface: 'browser', hasAudio: true }, stopped: 0, stop() { this.stopped++; } };
  captures.push(c);
  return c;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frame = () => new ArrayBuffer(3200); // 100 ms of 16 kHz PCM16
const lastSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
async function waitFor(cond: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}

function fresh() {
  FakeWebSocket.instances = [];
  captures = [];
  events = null;
  const c = new TranslatorController();
  c.setSettings({ ...DEFAULT_SETTINGS });
  return c;
}

const transcript = (id: string, seq: number, text: string, final: boolean, sub = 0, stable = 0) => ({ type: 'transcript', id, seq, sub, text, final, stable, startMs: seq * 1000, endMs: seq * 1000 + 900 });

test('listening: frames are sent, events arrive out of order but the history stays in spoken order', async () => {
  const c = fresh();
  c.init();
  await c.checkHealth();
  await c.startListening();
  await waitFor(() => c.getState().phase === 'listening');
  const ws = lastSocket();
  assert.equal(ws.json[0].type, 'start');
  assert.equal(ws.json[0].offsetMs, 0);

  for (let i = 0; i < 5; i++) events!.onFrame(frame());
  assert.equal(ws.frames, 5);

  // Segment 2 reports before segment 1; its translation also arrives before segment 1's.
  ws.emit(transcript('u2', 2, '二つ目です。', true));
  ws.emit({ type: 'translation', id: 'u2', text: 'อันที่สอง', final: true });
  ws.emit(transcript('u1', 1, '一つ', false, 0, 0));
  ws.emit(transcript('u1', 1, '一つ目です。', true));
  ws.emit({ type: 'translation', id: 'u1', text: 'อันแรก', final: true });
  ws.emit(transcript('u1', 1, '一', false)); // a late live refresh for a finished line
  const entries = c.getState().entries;
  assert.deepEqual(entries.map((e) => [e.ja, e.th]), [['一つ目です。', 'อันแรก'], ['二つ目です。', 'อันที่สอง']]);

  ws.emit({ type: 'translation_failed', id: 'u2' });
  assert.equal(c.getState().entries[1].thFailed, false, 'a failure report cannot undo a translation that already arrived');

  await c.stopListening();
  await waitFor(() => c.getState().phase === 'idle');
  c.dispose();
});

test('stopping releases the capture, ends the socket, ignores later audio, and leaves no timers', async () => {
  const c = fresh();
  c.init();
  await c.checkHealth();
  await c.startListening();
  await waitFor(() => c.getState().phase === 'listening');
  const ws = lastSocket();
  const cap = captures[0];
  assert.ok(liveTimers.size >= 2, 'while listening there is a clock tick and the health poll');

  await c.stopListening();
  assert.equal(cap.stopped, 1, 'media tracks are released immediately');
  assert.ok(ws.json.some((m) => m.type === 'stop'), 'the server is asked to finish the sentence in progress');
  const before = ws.frames;
  events!.onFrame(frame());
  assert.equal(ws.frames, before, 'audio after stopping is not sent');

  await waitFor(() => c.getState().phase === 'idle');
  assert.equal(ws.readyState, 3, 'socket closed');
  assert.equal(c.getState().source, null);
  c.dispose();
  assert.equal(liveTimers.size, 0, `timers left running: ${liveTimers.size}`);
});

test('a dropped connection reconnects, keeps timestamps continuous, and keeps old and new lines apart', async () => {
  const c = fresh();
  c.init();
  await c.checkHealth();
  await c.startListening();
  await waitFor(() => c.getState().phase === 'listening');
  const first = lastSocket();
  for (let i = 0; i < 20; i++) events!.onFrame(frame()); // 2 s
  first.emit(transcript('u1', 1, '最初です。', true));

  first.drop();
  assert.equal(c.getState().phase, 'connecting');
  assert.equal(c.getState().issue?.code, 'connection-lost');
  assert.equal(captures[0].stopped, 0, 'capture stays alive while reconnecting');
  for (let i = 0; i < 10; i++) events!.onFrame(frame()); // 1 s spoken during the outage is dropped, not queued
  assert.equal(first.frames, 20);

  await waitFor(() => FakeWebSocket.instances.length === 2 && c.getState().phase === 'listening', 4000);
  const second = lastSocket();
  assert.equal(second.json[0].offsetMs, 3000, 'timeline continues across the outage');
  assert.equal(c.getState().issue, null, 'the warning clears once reconnected');
  second.emit(transcript('u1', 1, '再接続後です。', true)); // the new connection starts counting from u1 again
  assert.deepEqual(c.getState().entries.map((e) => e.ja), ['最初です。', '再接続後です。']);

  await c.stopListening();
  await waitFor(() => c.getState().phase === 'idle');
  c.dispose();
  assert.equal(liveTimers.size, 0);
});

test('the browser ending the share stops everything and says why', async () => {
  const c = fresh();
  c.init();
  await c.checkHealth();
  await c.startListening();
  await waitFor(() => c.getState().phase === 'listening');
  const ws = lastSocket();
  events!.onEnded(captures[0]);
  await waitFor(() => c.getState().phase === 'idle');
  assert.equal(c.getState().issue?.code, 'capture-ended');
  assert.ok(ws.json.some((m) => m.type === 'stop'));
  assert.equal(ws.readyState, 3);
  c.dispose();
  assert.equal(liveTimers.size, 0);
});

test('a fatal provider error (quota) releases the capture instead of listening in vain', async () => {
  const c = fresh();
  c.init();
  await c.checkHealth();
  await c.startListening();
  await waitFor(() => c.getState().phase === 'listening');
  const ws = lastSocket();
  ws.emit({ type: 'error', code: 'QUOTA_EXCEEDED', message: 'out of credit', severity: 'error', recoverable: false });
  assert.equal(c.getState().phase, 'error');
  assert.equal(c.getState().issue?.code, 'quota-exceeded');
  assert.equal(captures[0].stopped, 1);
  assert.equal(ws.readyState, 3);
  c.dispose();
  assert.equal(liveTimers.size, 0);
});

test('a transient warning does not stop listening, and clears itself', async () => {
  const c = fresh();
  c.init();
  await c.checkHealth();
  await c.startListening();
  await waitFor(() => c.getState().phase === 'listening');
  lastSocket().emit({ type: 'error', code: 'RATE_LIMITED', message: 'slow down', severity: 'warning', recoverable: true });
  assert.equal(c.getState().issue?.code, 'rate-limited');
  assert.equal(c.getState().phase, 'listening');
  assert.equal(captures[0].stopped, 0);
  await c.stopListening();
  await waitFor(() => c.getState().phase === 'idle');
  c.dispose();
});
