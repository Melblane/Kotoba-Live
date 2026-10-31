import assert from 'node:assert/strict';
import test from 'node:test';
import { splitJapanese, trimOverlap, allocateTimes, commonPrefixLength } from '../src/sentences.js';
import { TranslationScheduler, type ContextLine, type TranslationJob } from '../src/translation-scheduler.js';
import { charAudio, charText, CharStt, defaultSettings, FakeStt, FakeTranslator, finals, join, runSession, silence, sleep, tone, translations } from './fixtures.js';

// ---- sentence segmentation -----------------------------------------------------------------

test('sentences split at 。！？ and each becomes its own subtitle', () => {
  const text = '今日はとてもいい天気ですね。それでは、次の話題に移りましょう。まず、この映像を見てください。';
  assert.deepEqual(splitJapanese(text), ['今日はとてもいい天気ですね。', 'それでは、次の話題に移りましょう。', 'まず、この映像を見てください。']);
  // Very short exchanges are merged rather than shown as one-word subtitles.
  assert.deepEqual(splitJapanese('本当ですか？はい！そうです。'), ['本当ですか？はい！そうです。']);
});

test('a short phrase with no punctuation stays whole', () => {
  assert.deepEqual(splitJapanese('今日はみんなに'), ['今日はみんなに']);
  assert.deepEqual(splitJapanese('紹介したい人がいます。'), ['紹介したい人がいます。']);
});

test('a long sentence is split at clause commas, never inside a clause', () => {
  const text = '昨日は友達と一緒に新宿まで買い物に行って、そのあと近くのレストランで夕食を食べて、最後に映画を見てから帰りました。';
  const parts = splitJapanese(text);
  assert.ok(parts.length >= 2 && parts.length <= 3, JSON.stringify(parts));
  assert.equal(parts.join(''), text, 'nothing lost or duplicated');
  for (const p of parts) assert.ok(p.length <= 34, `too long: ${p}`);
  assert.ok(parts.slice(0, -1).every((p) => p.endsWith('、')), 'breaks fall on the commas');
});

test('tiny fragments are merged with a neighbour instead of becoming their own subtitle', () => {
  const parts = splitJapanese('はい。それでは次の議題に入りましょう。');
  assert.equal(parts.length, 1);
  assert.equal(parts[0], 'はい。それでは次の議題に入りましょう。');
});

test('a long run with no punctuation breaks after a standalone conjunction, not mid-word', () => {
  const text = '昨日は雨が降っていたので家で一日中ゲームをしていましたけど今日は晴れたので友達と公園まで散歩に出かけます';
  const parts = splitJapanese(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.length >= 2, JSON.stringify(parts));
  assert.ok(parts[0].endsWith('ので') || parts[0].endsWith('けど'), `first piece should end on a conjunction: ${parts[0]}`);
});

test('time is spread over the pieces by length', () => {
  const t = allocateTimes(['あいうえ', 'かきくけこさしす'], 1000, 4000);
  assert.deepEqual(t, [{ startMs: 1000, endMs: 2000 }, { startMs: 2000, endMs: 4000 }]);
});

test('overlap trimming removes only the repeated start', () => {
  assert.equal(trimOverlap('今日は天気がいいですね', 'いいですね、散歩に行きましょう', 6), '散歩に行きましょう');
  assert.equal(trimOverlap('今日は天気がいいですね', '散歩に行きましょう', 6), '散歩に行きましょう', 'no overlap means no change');
  assert.equal(trimOverlap('今日は天気', '天気', 6), '', 'entirely repeated text disappears');
  assert.equal(trimOverlap('えーと', 'えーと今日は', 1), 'えーと今日は', 'respects the maximum overlap');
  assert.equal(commonPrefixLength('今日はいい', '今日はいい天気'), 5);
});

// ---- translation scheduler -------------------------------------------------------------------

function scheduler(delays: Record<string, number>, opts: ConstructorParameters<typeof TranslationScheduler>[1] = {}) {
  const t = { released: [] as string[], failed: [] as string[], finished: [] as string[], inFlight: 0, maxInFlight: 0, contexts: {} as Record<string, ContextLine[]>, calls: 0 };
  const s = new TranslationScheduler(
    {
      translate: async (job, ctx) => {
        t.calls++;
        t.inFlight++;
        t.maxInFlight = Math.max(t.maxInFlight, t.inFlight);
        t.contexts[job.id] = ctx;
        await sleep(delays[job.id] ?? 5);
        t.inFlight--;
        t.finished.push(job.id);
        if (job.text === 'FAIL') throw new Error('boom');
        return `TH:${job.text}`;
      },
      onResult: (id) => t.released.push(id),
      onFailure: (id) => t.failed.push(id),
    },
    opts,
  );
  const job = (id: string, text = id): TranslationJob => ({ id, text, continuation: false, incomplete: false });
  return { s, t, job };
}

test('results are released in spoken order even when the API answers out of order', async () => {
  const { s, t, job } = scheduler({ a: 90, b: 10, c: 10 });
  s.submit(job('a'));
  s.submit(job('b'));
  s.submit(job('c'));
  await s.drain();
  assert.notEqual(t.finished[0], 'a', 'a must actually have finished last for this test to mean anything');
  assert.deepEqual(t.released, ['a', 'b', 'c']);
});

test('requests run concurrently but never beyond the limit', async () => {
  const { s, t, job } = scheduler({}, { maxConcurrent: 2 });
  for (const id of ['1', '2', '3', '4', '5']) s.submit(job(id));
  await s.drain();
  assert.equal(t.maxInFlight, 2);
  assert.deepEqual(t.released, ['1', '2', '3', '4', '5']);
});

test('a very slow request does not freeze later finished ones forever', async () => {
  const { s, t, job } = scheduler({ a: 400, b: 10, c: 10 }, { headWaitMs: 60 });
  s.submit(job('a'));
  s.submit(job('b'));
  s.submit(job('c'));
  await sleep(200);
  assert.deepEqual(t.released, ['b', 'c'], 'b and c are let through once a has held them back too long');
  await s.drain();
  assert.deepEqual(t.released, ['b', 'c', 'a'], 'a still arrives, and fills its own slot by id');
});

test('a failed translation is reported and does not block the ones after it', async () => {
  const { s, t, job } = scheduler({});
  s.submit(job('a'));
  s.submit(job('b', 'FAIL'));
  s.submit(job('c'));
  await s.drain();
  assert.deepEqual(t.released, ['a', 'c']);
  assert.deepEqual(t.failed, ['b']);
});

test('the same subtitle is never translated or released twice', async () => {
  const { s, t, job } = scheduler({});
  s.submit(job('a'));
  s.submit(job('a'));
  await s.drain();
  assert.equal(t.calls, 1);
  assert.deepEqual(t.released, ['a']);
});

test('each request carries only a few earlier lines, with Thai where it is already known', async () => {
  const serial = scheduler({}, { maxConcurrent: 1, contextLines: 2 });
  for (const id of ['l1', 'l2', 'l3', 'l4']) serial.s.submit(serial.job(id));
  await serial.s.drain();
  assert.deepEqual(serial.t.contexts.l4, [{ ja: 'l2', th: 'TH:l2' }, { ja: 'l3', th: 'TH:l3' }]);
  assert.deepEqual(serial.t.contexts.l1, []);

  const parallel = scheduler({ l1: 30 }, { maxConcurrent: 3 });
  parallel.s.submit(parallel.job('l1'));
  parallel.s.submit(parallel.job('l2'));
  await parallel.s.drain();
  assert.deepEqual(parallel.t.contexts.l2, [{ ja: 'l1', th: null }], 'Japanese context is available even before the earlier Thai is');
});

test('disposing cancels everything and leaves no timers behind', async () => {
  const { s, t, job } = scheduler({ a: 150, b: 150 }, { headWaitMs: 20 });
  s.submit(job('a'));
  s.submit(job('b'));
  const waiting = s.drain(5000);
  s.dispose();
  await waiting;
  await sleep(250);
  assert.deepEqual(t.released, []);
  assert.deepEqual(s.stats, { pending: 0, running: 0, timers: 0 });
});

// ---- the whole pipeline, with audio the recognizer really reads ------------------------------

test('continuous speech: live text first, short segments, overlap removed, nothing lost or repeated', async () => {
  const source = charText(100); // 10 seconds of speech without a single pause
  const stt = new CharStt();
  const { messages } = await runSession(join(silence(500), charAudio(source), silence(1500)), { stt, translator: new FakeTranslator() });

  const f = finals(messages);
  assert.ok(f.length >= 2, `expected the speech to be cut into several segments, got ${f.length}`);
  assert.equal(f.map((x) => x.text).join(''), source, 'overlap audio must not duplicate or drop characters');

  for (const x of f) assert.ok(x.endMs - x.startMs <= 5600, `segment ${x.id} spans ${x.endMs - x.startMs} ms, over the length limit`);
  for (let i = 1; i < f.length; i++) assert.ok(f[i].startMs >= f[i - 1].startMs, 'time never runs backwards');

  // Live text appears before the first segment is final, and carries a stable-prefix length.
  const firstLive = messages.findIndex((m) => m.type === 'transcript' && !m.final && m.id === f[0].id);
  const firstFinal = messages.findIndex((m) => m.type === 'transcript' && m.final && m.id === f[0].id);
  assert.ok(firstLive >= 0 && firstLive < firstFinal, 'Japanese must show up while the sentence is still being spoken');
  const live = messages.filter((m) => m.type === 'transcript' && !m.final);
  assert.ok(live.every((m) => m.type === 'transcript' && Number.isInteger(m.stable) && m.stable >= 0 && m.stable <= m.text.length));

  // Every segment got its own translation request, in order.
  assert.deepEqual(translations(messages).map((t) => t.id), f.map((x) => x.id));
});

test('a short breath ends a segment quickly instead of waiting for a long silence', async () => {
  const audio = join(tone(1500, 0.3), silence(500), tone(1500, 0.6), silence(2000));
  const { messages } = await runSession(audio);
  const f = finals(messages);
  assert.equal(f.length, 2, 'a 500 ms pause (five silent 100 ms frames) is enough to split two phrases');
  const firstOfSecond = messages.findIndex((m) => 'id' in m && m.id === f[1].id);
  assert.ok(messages.findIndex((m) => m.type === 'transcript' && m.final && m.id === f[0].id) < firstOfSecond, 'first phrase was finalized before the second began');
});

test('a slow translation API never holds back the next transcript', async () => {
  const slow = new FakeTranslator((n) => (n === 1 ? 250 : 5));
  const audio = join(tone(1500, 0.3), silence(500), tone(1500, 0.6), silence(2000));
  const { messages } = await runSession(audio, { translator: slow });
  const f = finals(messages);
  const secondTranscript = messages.findIndex((m) => m.type === 'transcript' && m.final && m.id === f[1].id);
  const firstTranslation = messages.findIndex((m) => m.type === 'translation' && m.id === f[0].id);
  assert.ok(secondTranscript < firstTranslation, 'the second sentence appears in Japanese while the first is still being translated');
  assert.deepEqual(translations(messages).map((t) => t.id), f.map((x) => x.id), 'but Thai is still released in spoken order');
  assert.deepEqual(slow.finished[0], 'さようなら、また明日。', 'the later request really did finish first');
});

test('stopping leaves nothing running: no timers, no pending translations', async () => {
  const { leftovers, messages } = await runSession(join(tone(1500, 0.3), silence(500), tone(1500, 0.6)), { translator: new FakeTranslator(() => 30) });
  assert.equal(messages.at(-1)?.type, 'stopped');
  assert.deepEqual(leftovers, { scheduler: { pending: 0, running: 0, timers: 0 }, sttBusy: false });
});

test('speech that changes quickly keeps its ids stable and never resurrects a finished segment', async () => {
  const audio = join(tone(900, 0.3), silence(500), tone(900, 0.6), silence(500), tone(900, 0.3), silence(500), tone(900, 0.6), silence(1500));
  const { messages } = await runSession(audio, { stt: new FakeStt() });
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.type === 'transcript' && m.final) {
      assert.ok(!seen.has(m.id), `duplicate final for ${m.id}`);
      seen.add(m.id);
    }
    if (m.type === 'transcript' && !m.final) assert.ok(!seen.has(m.id), `live text for ${m.id} arrived after it was final`);
  }
  assert.equal(seen.size, 4);
});

test('long sentences from the recognizer are split into several short subtitles with their own translations', async () => {
  const long = 'おはようございます。今日はとてもいい天気ですね。それでは、次の話題に移りましょう。';
  const { messages } = await runSession(join(tone(2500, 0.3), silence(1500)), { stt: new FakeStt(long), translator: new FakeTranslator() });
  const f = finals(messages);
  assert.deepEqual(f.map((x) => x.text), ['おはようございます。', '今日はとてもいい天気ですね。', 'それでは、次の話題に移りましょう。']);
  assert.deepEqual(f.map((x) => x.sub), [0, 1, 2]);
  assert.deepEqual(f.map((x) => x.id), ['u1', 'u1.1', 'u1.2']);
  assert.equal(translations(messages).length, 3);
  assert.ok(f[0].endMs <= f[1].startMs + 1 && f[1].endMs <= f[2].startMs + 1, 'pieces share the segment time without overlapping');
  assert.equal(defaultSettings.latency, 'balanced');
});
