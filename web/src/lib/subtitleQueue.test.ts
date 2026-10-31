import assert from 'node:assert/strict';
import test from 'node:test';
import type { SubtitleEntry } from '../types';
import { FADE_MS, fitRows, LOST_TRANSLATION_MS, MIN_SHOW_MS, readingMs, SubtitleQueue, type QueueOptions } from './subtitleQueue';

let n = 0;
const entry = (id: string, o: Partial<SubtitleEntry> = {}): SubtitleEntry => ({
  id, session: 1, order: ++n, ja: '', th: '', jaFinal: false, thFinal: false, thFailed: false, jaStable: 0,
  startMs: 0, endMs: 0, wallTime: 0, jaFinalAt: null, ...o,
});
const done = (id: string, ja = '今日はいい天気ですね。', th = 'วันนี้อากาศดีจังเลยนะ', at = 0) =>
  entry(id, { ja, th, jaFinal: true, thFinal: true, jaFinalAt: at, jaStable: ja.length });

const OPT: QueueOptions = { mode: 'both', showInterim: true, needsThai: true, maxVisible: 4, durationScale: 1, keepLonger: false };
const ids = (q: SubtitleQueue, entries: SubtitleEntry[], now: number, o = OPT) => q.update(entries, o, now).rows.map((r) => r.id);

test('a new line never removes an older line that is still being read', () => {
  const q = new SubtitleQueue();
  const a = done('a');
  assert.deepEqual(ids(q, [a], 0), ['a']);
  const b = entry('b', { ja: 'それでは、', jaStable: 0 });
  const view = q.update([a, b], OPT, 1000);
  assert.deepEqual(view.rows.map((r) => r.id), ['a', 'b'], 'older line stays, newer one is added below it');
  assert.equal(view.rows[0].leaving, false);
  assert.equal(view.rows[1].status, 'interim');
});

test('one row follows a sentence from live text to translated, with the same id throughout', () => {
  const q = new SubtitleQueue();
  const seen: string[] = [];
  const step = (e: SubtitleEntry, now: number) => {
    const rows = q.update([e], OPT, now).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'x', 'a stable id means the row is updated in place, not replaced');
    seen.push(rows[0].status);
  };
  step(entry('x', { ja: 'こん', jaStable: 0 }), 0);
  step(entry('x', { ja: 'こんにちは', jaStable: 2 }), 500);
  step(entry('x', { ja: 'こんにちは。', jaFinal: true, jaFinalAt: 1000 }), 1000);
  step(entry('x', { ja: 'こんにちは。', jaFinal: true, jaFinalAt: 1000, th: 'สวัสดี', thFinal: true }), 1600);
  assert.deepEqual(seen, ['interim', 'interim', 'translating', 'final']);
});

test('the reading clock starts when the Thai is ready, not while the line is waiting to be translated', () => {
  const q = new SubtitleQueue();
  const waiting = entry('a', { ja: '今日はいい天気ですね。', jaFinal: true, jaFinalAt: 0 });
  assert.equal(q.update([waiting], OPT, 0).rows[0].status, 'translating');
  // It sits in the queue for far longer than a reading time without expiring.
  assert.equal(q.update([waiting], OPT, 9000).rows[0].leaving, false);

  const a = done('a', '今日はいい天気ですね。', 'วันนี้อากาศดีจังเลยนะ', 0);
  const read = readingMs(a, OPT);
  assert.equal(q.update([a], OPT, 10_000).rows[0].leaving, false);
  assert.equal(q.update([a], OPT, 10_000 + read - 1).rows[0].leaving, false, 'still readable just before the time is up');
  const fading = q.update([a], OPT, 10_000 + read);
  assert.equal(fading.rows[0].leaving, true, 'fades once the reading time is up');
  assert.deepEqual(ids(q, [a], 10_000 + read + FADE_MS), [], 'and is gone after the fade');
});

test('reading time follows the length of the text and the user setting', () => {
  const short = done('s', 'はい。', 'ครับ');
  const long = done('l', 'それでは、次の話題に移りましょう。まずこの映像を見てください。', 'ถ้าอย่างนั้น เราไปหัวข้อถัดไปกันเลย ก่อนอื่นลองดูวิดีโอนี้ก่อนนะครับ ทุกคนพร้อมกันหรือยัง');
  assert.equal(readingMs(short, OPT), 3000, 'short lines get the minimum');
  assert.ok(readingMs(long, OPT) > 6000 && readingMs(long, OPT) <= 9000, `long line ${readingMs(long, OPT)}`);
  assert.equal(readingMs(short, { ...OPT, durationScale: 2 }), 6000);
  assert.equal(readingMs(short, { ...OPT, keepLonger: true }), 9000, 'history mode keeps lines about three times longer');
  assert.ok(readingMs(long, { ...OPT, durationScale: 3, keepLonger: true }) <= 30_000, 'but never without limit');
});

test('when the screen is full the oldest line goes, but only after a fair reading time and never the newest', () => {
  const q = new SubtitleQueue();
  const o = { ...OPT, maxVisible: 2 };
  const list = [done('a'), done('b'), done('c')];
  assert.deepEqual(ids(q, list, 0, o), ['a', 'b', 'c'], 'allowed to run one over for a moment rather than cutting a line the viewer has not had time to read');
  assert.equal(q.update(list, o, MIN_SHOW_MS - 1).rows[0].leaving, false);
  const view = q.update(list, o, MIN_SHOW_MS);
  assert.equal(view.rows[0].leaving, true);
  assert.equal(view.rows[2].leaving, false, 'the newest line is never pushed out');
  assert.deepEqual(ids(q, list, MIN_SHOW_MS + FADE_MS, o), ['b', 'c']);

  const q2 = new SubtitleQueue();
  const one = { ...OPT, maxVisible: 1 };
  const pair = [done('a'), done('b')];
  q2.update(pair, one, 0);
  const rows = q2.update(pair, one, MIN_SHOW_MS).rows;
  assert.equal(rows.at(-1)?.leaving, false);
});

test('expired lines stay gone, and the history it was built from is never touched', () => {
  const q = new SubtitleQueue();
  const history = [done('a')];
  const copy = JSON.stringify(history);
  const read = readingMs(history[0], OPT);
  q.update(history, OPT, 0);
  q.update(history, OPT, read);
  assert.deepEqual(ids(q, history, read + FADE_MS), []);
  assert.deepEqual(ids(q, history, read + FADE_MS + 5000), [], 'does not come back');
  assert.equal(JSON.stringify(history), copy, 'the queue only reads the history');
});

test('Thai-only: lines wait for their Thai without disturbing earlier ones', () => {
  const q = new SubtitleQueue();
  const o = { ...OPT, mode: 'thai' as const };
  const a = done('a');
  const b = entry('b', { ja: '次の話題です。', jaFinal: true, jaFinalAt: 1000 });
  assert.deepEqual(ids(q, [a, b], 1000, o), ['a'], 'b has no Thai yet, so nothing is shown for it');
  const rows = q.update([a, { ...b, th: 'หัวข้อถัดไปค่ะ', thFinal: true }], o, 2000).rows;
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
  assert.equal(rows[1].showJa, false);
  assert.equal(rows[1].showTh, true);
});

test('a translation that never arrives does not hold a line forever', () => {
  const q = new SubtitleQueue();
  const lost = entry('a', { ja: '今日は晴れです。', jaFinal: true, jaFinalAt: 0 });
  assert.equal(q.update([lost], OPT, 1000).rows[0].status, 'translating');
  const later = q.update([lost], OPT, LOST_TRANSLATION_MS + 1);
  assert.equal(later.rows[0].status, 'final');
  const T = LOST_TRANSLATION_MS + 1;
  assert.equal(q.update([lost], OPT, T + readingMs(lost, OPT) - 1).rows[0].leaving, false, 'it gets its normal reading time from the moment it gave up waiting');
  assert.equal(q.update([lost], OPT, T + readingMs(lost, OPT)).rows[0].leaving, true);
  const failed = entry('f', { ja: '失敗しました。', jaFinal: true, jaFinalAt: 0, thFailed: true });
  assert.equal(q.update([failed], { ...OPT, mode: 'thai' }, 0).rows[0].showJa, true, 'falls back to the Japanese');
});

test('without a translator, Japanese is final as soon as it is final', () => {
  const q = new SubtitleQueue();
  const row = q.update([entry('a', { ja: '日本語だけ。', jaFinal: true, jaFinalAt: 0 })], { ...OPT, needsThai: false }, 0).rows[0];
  assert.equal(row.status, 'final');
  assert.equal(row.showTh, false);
  assert.equal(row.showJa, true);
});

test('live text can be switched off, and finished lines still show', () => {
  const q = new SubtitleQueue();
  const o = { ...OPT, showInterim: false };
  assert.deepEqual(ids(q, [done('a'), entry('b', { ja: 'まだ話している' })], 0, o), ['a']);
});

test('the queue sleeps until the next real deadline and wakes for nothing else', () => {
  const q = new SubtitleQueue();
  const a = done('a');
  assert.equal(q.update([entry('x', { ja: '話し中' })], OPT, 0).nextWakeAt, null, 'live text alone needs no timer');
  const view = q.update([a], OPT, 0);
  assert.equal(view.nextWakeAt, readingMs(a, OPT));
  const fading = q.update([a], OPT, readingMs(a, OPT));
  assert.equal(fading.nextWakeAt, readingMs(a, OPT) + FADE_MS);
});

test('rows that fit: the stack shrinks to the space instead of covering the video', () => {
  const base = { fontPx: 40, showJa: true, showTh: true, maxRows: 5 };
  assert.equal(fitRows({ ...base, availableHeight: 0 }), 5, 'unknown size means no limit beyond the setting');
  assert.equal(fitRows({ ...base, availableHeight: 80 }), 1, 'always at least one');
  assert.ok(fitRows({ ...base, availableHeight: 330 }) >= 2 && fitRows({ ...base, availableHeight: 330 }) < 5);
  assert.equal(fitRows({ ...base, availableHeight: 5000 }), 5, 'never more than the setting');
  assert.ok(fitRows({ ...base, showJa: false, availableHeight: 330 }) >= fitRows({ ...base, availableHeight: 330 }), 'Thai-only rows are shorter, so more fit');
});
