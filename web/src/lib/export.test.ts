import assert from 'node:assert/strict';
import test from 'node:test';
import type { SubtitleEntry } from '../types';
import { entriesReducer } from './entries';
import { buildSrt, buildTxt, srtTime } from './export';
import { sanitizeSettings, DEFAULT_SETTINGS } from './settings';

const entry = (o: Partial<SubtitleEntry>): SubtitleEntry => ({
  id: 'x', session: 1, order: 0, ja: 'こんにちは', th: 'สวัสดี', jaFinal: true, thFinal: true, thFailed: false, jaStable: 5,
  startMs: 0, endMs: 1500, wallTime: 0, jaFinalAt: 0, ...o,
});

test('srtTime formats hours, minutes, seconds and milliseconds', () => {
  assert.equal(srtTime(3_723_456), '01:02:03,456');
  assert.equal(srtTime(0), '00:00:00,000');
});

test('buildSrt writes numbered cues in the requested language mode', () => {
  const list = [entry({ id: 'a', startMs: 1000, endMs: 2500 }), entry({ id: 'b', ja: 'さようなら', th: 'ลาก่อน', startMs: 4000, endMs: 5200 })];
  assert.equal(
    buildSrt(list, 'thai'),
    '1\n00:00:01,000 --> 00:00:02,500\nสวัสดี\n\n2\n00:00:04,000 --> 00:00:05,200\nลาก่อน\n',
  );
  assert.ok(buildSrt(list, 'both').includes('こんにちは\nสวัสดี'));
  assert.ok(buildSrt(list, 'japanese').includes('さようなら'));
});

test('buildSrt shifts later sessions so cues never overlap, and skips demo and unfinished rows', () => {
  const list = [
    entry({ id: 'a', session: 1, startMs: 0, endMs: 3000 }),
    entry({ id: 'd', session: 1, demo: true, startMs: 500 }),
    entry({ id: 'p', session: 1, thFinal: false, th: '' }),
    entry({ id: 'b', session: 2, startMs: 0, endMs: 1000 }),
  ];
  const srt = buildSrt(list, 'thai');
  assert.equal((srt.match(/-->/g) ?? []).length, 2);
  assert.ok(srt.includes('00:00:05,000 --> 00:00:06,000'), srt); // 3 s session + 2 s gap
});

test('buildTxt omits demo data', () => {
  const txt = buildTxt([entry({ id: 'a' }), entry({ id: 'd', demo: true, ja: 'デモ' })]);
  assert.ok(txt.includes('こんにちは') && !txt.includes('デモ'));
});

const base = { startMs: 0, endMs: 1000, session: 1, at: 1000 };

test('reducer: live text updates one row, finals are never overwritten by late events', () => {
  let s = entriesReducer([], { type: 'transcript', key: 'c1:u1', order: 1000, text: 'こん', final: false, stable: 0, ...base });
  s = entriesReducer(s, { type: 'transcript', key: 'c1:u1', order: 1000, text: 'こんにちは', final: false, stable: 2, ...base });
  assert.equal(s.length, 1);
  assert.equal(s[0].jaStable, 2);
  s = entriesReducer(s, { type: 'transcript', key: 'c1:u1', order: 1000, text: 'こんにちは。', final: true, ...base });
  assert.equal(s[0].jaStable, s[0].ja.length);
  s = entriesReducer(s, { type: 'transcript', key: 'c1:u1', order: 1000, text: 'こん', final: false, ...base });
  assert.equal(s[0].ja, 'こんにちは。', 'a late live refresh cannot overwrite final text');
  s = entriesReducer(s, { type: 'translation', key: 'c1:u1', text: 'สวัสดี', final: true });
  s = entriesReducer(s, { type: 'translation', key: 'c1:u1', text: 'ส', final: false });
  assert.equal(s[0].th, 'สวัสดี', 'a late draft cannot overwrite the final translation');
  assert.equal(s.length, 1);
});

test('reducer: the same words said twice are two lines, because only the server can tell a repeat from an echo', () => {
  let s = entriesReducer([], { type: 'transcript', key: 'c1:u1', order: 1000, text: 'はい、はい', final: true, ...base });
  s = entriesReducer(s, { type: 'transcript', key: 'c1:u2', order: 2000, text: 'はい、はい', final: true, ...base });
  assert.equal(s.length, 2);
});

test('reducer: lines are kept in spoken order even when events arrive out of order', () => {
  let s = entriesReducer([], { type: 'transcript', key: 'c1:u2', order: 2000, text: '二つ目', final: true, ...base });
  s = entriesReducer(s, { type: 'transcript', key: 'c1:u1', order: 1000, text: '一つ目', final: true, ...base });
  s = entriesReducer(s, { type: 'transcript', key: 'c1:u1.1', order: 1001, text: '一つ目の続き', final: true, ...base });
  s = entriesReducer(s, { type: 'transcript', key: 'c2:u1', order: 1_000_001_000, text: '再接続後', final: true, ...base });
  assert.deepEqual(s.map((e) => e.id), ['c1:u1', 'c1:u1.1', 'c1:u2', 'c2:u1']);
});

test('reducer: a failed translation is recorded, a discarded live line is dropped, final lines are kept', () => {
  let s = entriesReducer([], { type: 'transcript', key: 'a', order: 1, text: '確定', final: true, ...base });
  s = entriesReducer(s, { type: 'transcript', key: 'b', order: 2, text: '雑音', final: false, ...base });
  s = entriesReducer(s, { type: 'translationFailed', key: 'a' });
  assert.equal(s[0].thFailed, true);
  s = entriesReducer(s, { type: 'discard', key: 'b' });
  s = entriesReducer(s, { type: 'discard', key: 'a' });
  assert.deepEqual(s.map((e) => e.id), ['a']);
  s = entriesReducer(s, { type: 'translation', key: 'a', text: 'สวัสดี', final: true });
  assert.equal(s[0].thFailed, false, 'a translation that arrives later clears the failure');
});

test('stored settings are validated', () => {
  const s = sanitizeSettings({ fontSize: 999, position: 'sideways', textColor: 'red', bgOpacity: -4, displayMode: 'thai' });
  assert.equal(s.fontSize, 72);
  assert.equal(s.position, DEFAULT_SETTINGS.position);
  assert.equal(s.textColor, DEFAULT_SETTINGS.textColor);
  assert.equal(s.bgOpacity, 0);
  assert.equal(s.displayMode, 'thai');
  const t = sanitizeSettings({ overlayDuration: 99, overlayLines: 2.6, keepLonger: 'yes', draftTranslation: true });
  assert.equal(t.overlayDuration, 3);
  assert.equal(t.overlayLines, 3);
  assert.equal(t.keepLonger, false);
  assert.equal(t.draftTranslation, true);
  assert.equal(sanitizeSettings({}).overlayLines, 4, 'older saved settings get the new defaults');
});
