import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createAppServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { ServerMessage } from '../src/protocol.js';
import type { TranslateProvider } from '../src/providers/types.js';
import { TranslatorSession } from '../src/session.js';
import { isHallucination, normalize, parseGlossary } from '../src/text.js';
import {
  defaultSettings, FakeStt, FakeTranslator, finals, frames, join, runSession, silence, sleep, tone, translations,
} from './fixtures.js';

test('two utterances become two ordered, translated subtitles with live text in between', async () => {
  const translator = new FakeTranslator();
  const audio = join(silence(1000), tone(2500, 0.3), silence(1500), tone(2000, 0.6), silence(1500));
  const { messages } = await runSession(audio, { translator });

  const f = finals(messages);
  assert.deepEqual(f.map((x) => x.text), ['こんにちは、元気ですか。', 'さようなら、また明日。']);
  assert.notEqual(f[0].id, f[1].id);
  assert.ok(f[0].seq < f[1].seq, 'seq follows spoken order');
  assert.ok(f[0].startMs >= 800 && f[0].startMs <= 1100, `start ${f[0].startMs}`);
  assert.ok(f[0].endMs > f[0].startMs && f[1].startMs >= f[0].endMs);

  const live = messages.filter((m) => m.type === 'transcript' && !m.final && m.id === f[0].id);
  assert.ok(live.length >= 1, 'expected live text while the first sentence was still being spoken');
  assert.equal(f[0].id, live[0].type === 'transcript' ? live[0].id : '', 'final reuses the live text id so the UI updates one row');

  const th = translations(messages);
  assert.deepEqual(th.map((x) => x.text), ['TH(こんにちは、元気ですか。)', 'TH(さようなら、また明日。)']);
  assert.deepEqual(th.map((x) => x.id), f.map((x) => x.id));

  // The second request carries the first pair as context, and only that.
  assert.deepEqual(translator.requests[1].context, [{ ja: 'こんにちは、元気ですか。', th: 'TH(こんにちは、元気ですか。)' }]);

  assert.equal(messages.at(-1)?.type, 'stopped');
  assert.ok(messages.findIndex((m) => m.type === 'transcript' && m.final && m.id === f[0].id) < messages.findIndex((m) => m.type === 'translation' && m.id === f[0].id));
});

test('repeated identical sentences right after each other are not duplicated', async () => {
  const { messages } = await runSession(join(tone(1500, 0.3), silence(1500), tone(1500, 0.3), silence(1500)));
  assert.equal(finals(messages).length, 1);
  assert.ok(messages.some((m) => m.type === 'discard'));
});

test('known Whisper hallucinations over noise are discarded', async () => {
  const { messages } = await runSession(join(tone(1500, 0.3), silence(1500)), { stt: new FakeStt('ご視聴ありがとうございました') });
  assert.equal(finals(messages).length, 0);
  assert.ok(messages.some((m) => m.type === 'discard'));
});

test('very short blips never reach the speech recognizer', async () => {
  const stt = new FakeStt();
  const { messages } = await runSession(join(silence(500), tone(100, 0.3), silence(1500)), { stt });
  assert.equal(stt.calls, 0);
  assert.equal(finals(messages).length, 0);
});

test('unbroken speech is cut into several subtitles at the maximum length', async () => {
  const { messages } = await runSession(tone(12_000, 0.3), { settings: { ...defaultSettings, latency: 'fast' } });
  // The fake recognizer returns the same sentence each time, so the duplicate filter may drop some.
  const completed = new Set(messages.filter((m) => (m.type === 'transcript' && m.final) || m.type === 'discard').map((m) => (m as { id: string }).id));
  assert.ok(completed.size >= 2, `expected a forced split, got ${completed.size}`);
  const stoppedAt = messages.findIndex((m) => m.type === 'stopped');
  const firstDone = messages.findIndex((m) => (m.type === 'transcript' && m.final) || m.type === 'discard');
  assert.ok(firstDone < stoppedAt - 1, 'first part must complete before the session stops');
});

test('timestamps continue from the offset passed by the client', async () => {
  const messages: ServerMessage[] = [];
  const session = new TranslatorSession({ stt: new FakeStt(), translator: null, send: (m) => messages.push(m), settings: defaultSettings, offsetMs: 60_000 });
  for (const f of frames(join(tone(1500, 0.3), silence(1500)))) {
    session.pushAudio(f);
    await sleep(2);
  }
  await session.stop();
  const first = finals(messages)[0];
  assert.ok(first.startMs >= 60_000 && first.startMs < 60_500);
  assert.equal(messages.some((m) => m.type === 'translation'), false, 'no translator means Japanese-only output');
});

test('clients that stream audio far faster than real time are rejected', () => {
  const session = new TranslatorSession({ stt: new FakeStt(), translator: null, send: () => undefined, settings: defaultSettings });
  let rejected = false;
  for (const f of frames(tone(30_000, 0.3))) {
    if (!session.pushAudio(f)) {
      rejected = true;
      break;
    }
  }
  session.dispose();
  assert.ok(rejected);
});

test('text helpers', () => {
  assert.equal(normalize('Hello, 世界！ '), 'hello世界');
  assert.ok(isHallucination('♪～'));
  assert.ok(isHallucination('ご視聴ありがとうございました。'));
  assert.ok(isHallucination('あああああああああああああああああああ'));
  assert.ok(!isHallucination('ありがとうございました、助かりました'));
  assert.deepEqual(parseGlossary('田中 = ทานากะ\nbad line\nさくら -> ซากุระ'), [
    { ja: '田中', th: 'ทานากะ' },
    { ja: 'さくら', th: 'ซากุระ' },
  ]);
});

// ---- real HTTP + WebSocket path ------------------------------------------------------

async function startServer(env: Record<string, string> = {}, translator: TranslateProvider | null = new FakeTranslator()) {
  const config = loadConfig({ PORT: '0', HOST: '127.0.0.1', ...env });
  const app = createAppServer(config, { stt: new FakeStt(), translator });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const port = (app.server.address() as AddressInfo).port;
  return { ...app, port };
}

function collect(ws: WebSocket): ServerMessage[] {
  const out: ServerMessage[] = [];
  ws.on('message', (d, bin) => !bin && out.push(JSON.parse(d.toString())));
  return out;
}
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}

test('WebSocket: full session over the network', async () => {
  const s = await startServer();
  try {
    const health = (await (await fetch(`http://127.0.0.1:${s.port}/api/health`)).json()) as { stt: { configured: boolean }; translate: { configured: boolean } };
    assert.equal(health.stt.configured, true);
    assert.equal(JSON.stringify(health).includes('key'), false, 'health must not expose secrets');

    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { Origin: `http://127.0.0.1:${s.port}` } });
    const msgs = collect(ws);
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'start', offsetMs: 0, settings: { sourceLang: 'ja', latency: 'balanced', partialTranslation: false, glossary: '' } }));
    await until(() => msgs.some((m) => m.type === 'ready'));

    for (const f of frames(join(tone(2000, 0.3), silence(1500)))) (ws.send(f), await sleep(2));
    await until(() => msgs.some((m) => m.type === 'translation' && m.final));
    ws.send(JSON.stringify({ type: 'stop' }));
    await until(() => msgs.some((m) => m.type === 'stopped'));
    ws.close();
    assert.equal(msgs.filter((m) => m.type === 'transcript' && m.final).length, 1);
  } finally {
    await s.close();
  }
});

test('WebSocket: rejects missing origin, wrong token, and malformed messages', async () => {
  const s = await startServer({ ACCESS_TOKEN: 'secret' });
  try {
    const noOrigin = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    const [, res] = (await once(noOrigin, 'unexpected-response')) as [unknown, { statusCode: number }];
    assert.equal(res.statusCode, 403);

    const open = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { Origin: `http://127.0.0.1:${s.port}` } });
      const msgs = collect(ws);
      await once(ws, 'open');
      return { ws, msgs };
    };

    const a = await open();
    a.ws.send(JSON.stringify({ type: 'start', token: 'nope' }));
    await until(() => a.msgs.some((m) => m.type === 'error' && m.code === 'AUTH_REQUIRED'));

    const b = await open();
    b.ws.send('{not json');
    await until(() => b.msgs.some((m) => m.type === 'error' && m.code === 'BAD_REQUEST'));

    const c = await open();
    c.ws.send(JSON.stringify({ type: 'start', token: 'secret' }));
    await until(() => c.msgs.some((m) => m.type === 'ready'));
    c.ws.close();
  } finally {
    await s.close();
  }
});

test('WebSocket: without a translator the client is told, and Japanese still flows', async () => {
  const s = await startServer({}, null);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { Origin: `http://127.0.0.1:${s.port}` } });
    const msgs = collect(ws);
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'start' }));
    await until(() => msgs.some((m) => m.type === 'error' && m.code === 'TRANSLATE_NOT_CONFIGURED'));
    ws.close();
  } finally {
    await s.close();
  }
});
