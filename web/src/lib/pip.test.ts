import assert from 'node:assert/strict';
import test from 'node:test';
import type { OverlayRow } from '../types';
import { DEFAULT_SETTINGS } from './settings';
import { drawRows } from './pip';

/** A recording stand-in for a canvas 2D context. Text width is a simple function of size and length. */
function fakeCanvas(width = 1280, height = 360) {
  const texts: Array<{ text: string; y: number; alpha: number }> = [];
  let alpha = 1;
  const ctx = {
    font: '500 20px sans-serif',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
    get globalAlpha() { return alpha; },
    set globalAlpha(v: number) { alpha = v; },
    fillRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    measureText(t: string) { return { width: t.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '20') * 0.6 }; },
    fillText(text: string, _x: number, y: number) { texts.push({ text, y, alpha }); },
  };
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, texts };
}

const row = (id: string, th: string, o: Partial<OverlayRow> = {}): OverlayRow => ({
  id, ja: `日本語${id}`, th, stable: 5, status: 'final', leaving: false, showJa: true, showTh: true, ...o,
});
const settings = { ...DEFAULT_SETTINGS, fontSize: 36, overlayLines: 4 };

test('video fallback draws the whole stack, oldest on top and newest at the bottom', () => {
  const { canvas, texts } = fakeCanvas(1280, 600); // tall enough for three rows at this font size
  drawRows(canvas, [row('a', 'หนึ่ง'), row('b', 'สอง'), row('c', 'สาม')], settings);
  const y = (needle: string) => texts.find((t) => t.text === needle)?.y ?? NaN;
  assert.ok(y('หนึ่ง') < y('สอง') && y('สอง') < y('สาม'), 'rows are drawn top to bottom in spoken order');
  assert.ok(y('日本語a') < y('หนึ่ง'), 'Japanese sits above its Thai');
  const alphaOf = (needle: string) => texts.find((t) => t.text === needle)?.alpha ?? NaN;
  assert.ok(alphaOf('สาม') > alphaOf('สอง') && alphaOf('สอง') > alphaOf('หนึ่ง'), 'older rows are dimmer');
});

test('video fallback skips rows that are fading out and says so when there is nothing to show', () => {
  const faded = fakeCanvas();
  drawRows(faded.canvas, [row('a', 'หนึ่ง', { leaving: true }), row('b', 'สอง')], settings);
  assert.ok(!faded.texts.some((t) => t.text === 'หนึ่ง'));
  assert.ok(faded.texts.some((t) => t.text === 'สอง'));

  const empty = fakeCanvas();
  drawRows(empty.canvas, [], settings);
  assert.deepEqual(empty.texts.map((t) => t.text), ['Waiting for speech…']);
});

test('video fallback never covers the whole window: it drops the oldest rows first and always keeps the newest', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id, i) => row(id, `ไทย${i}`));
  const roomy = fakeCanvas(1280, 600);
  drawRows(roomy.canvas, rows, settings);
  const small = fakeCanvas(1280, 200);
  drawRows(small.canvas, rows, settings);
  const count = (t: ReturnType<typeof fakeCanvas>) => ['ไทย0', 'ไทย1', 'ไทย2', 'ไทย3'].filter((x) => t.texts.some((s) => s.text === x)).length;
  assert.equal(count(roomy), 4);
  assert.ok(count(small) < 4 && count(small) >= 1);
  assert.ok(small.texts.some((t) => t.text === 'ไทย3'), 'the newest row survives');
  assert.ok(small.texts.every((t) => t.y < 200), 'everything stays inside the canvas');
});

test('video fallback respects Thai-only and live (still unsettled) rows', () => {
  const { canvas, texts } = fakeCanvas();
  drawRows(canvas, [row('a', 'หนึ่ง', { showJa: false }), row('b', '', { status: 'interim', showTh: false })], { ...settings, displayMode: 'both' });
  assert.ok(!texts.some((t) => t.text === '日本語a'), 'a Thai-only row has no Japanese line');
  assert.ok(texts.some((t) => t.text === '日本語b'), 'live Japanese is drawn');
  assert.ok(texts.find((t) => t.text === '日本語b')!.alpha < 1, 'and dimmed');
});
