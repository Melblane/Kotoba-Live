import assert from 'node:assert/strict';
import test from 'node:test';
import { dom, liveTimers } from './env.js';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const text = () => document.body.textContent ?? '';
const button = (label: string | RegExp) =>
  Array.from(document.querySelectorAll('button')).find((b) => (typeof label === 'string' ? b.textContent?.trim() === label || b.getAttribute('aria-label') === label : label.test(b.textContent ?? ''))) as HTMLButtonElement | undefined;
async function click(el: Element | undefined | null) {
  assert.ok(el, 'element to click was not found');
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(0);
  });
}

test('the app renders, handles missing API keys, runs demo mode, and drives every view', async () => {
  const root = createRoot(document.getElementById('root')!);
  try {
    await run(root);
    await act(async () => root.unmount());
    await sleep(50);
    assert.equal(liveTimers.size, 0, `timers still running after the app unmounted: ${liveTimers.size}`);
  } finally {
    try {
      await act(async () => root.unmount());
    } catch {
      /* already unmounted by the happy path */
    }
    dom.window.close();
  }
});

async function run(root: ReturnType<typeof createRoot>) {
  await act(async () => {
    root.render(<App />);
    await sleep(300);
  });

  // Live view basics
  assert.ok(text().includes('Japanese → Thai Live Translator'));
  assert.ok(button('Select Window / Tab'), 'Select Window / Tab button');
  assert.ok(button('Start Listening'), 'Start Listening button');
  assert.ok(text().includes('API keys missing'), 'sidebar should report missing keys');

  // Start without keys: blocked with a clear explanation instead of a silent failure
  await click(button('Start Listening'));
  assert.ok(text().includes('Speech recognition is not set up'));

  // Subtitles stack instead of replacing each other. Turn the overlay on first so we can watch it.
  await click(document.querySelector('button[aria-label="In-app subtitle overlay"]'));
  assert.equal(JSON.parse(localStorage.getItem('kotoba-live:settings:v1')!).overlayEnabled, true);

  // Demo mode is explicitly labeled and produces lines
  await click(button('Try demo data'));
  assert.ok(text().includes('Demo mode.'));
  const overlayRows = () => Array.from(document.querySelectorAll<HTMLElement>('div.fixed [data-subtitle-row]'));
  const FIRST_TH = 'อรุณสวัสดิ์ วันนี้มาเช้าจังเลยนะ';

  await act(async () => {
    await sleep(2600);
  });
  assert.equal(overlayRows().length, 1, 'first line is on screen');
  assert.ok(overlayRows()[0].textContent?.includes(FIRST_TH), 'with its Thai translation');
  assert.equal(overlayRows()[0].dataset.status, 'final');

  await act(async () => {
    await sleep(2300); // the second sentence is now being heard and shown live
  });
  const stacked = overlayRows();
  assert.ok(stacked.length >= 2, `a new line must not replace the one being read, saw ${stacked.length} row(s)`);
  assert.ok(stacked[0].textContent?.includes(FIRST_TH), 'older line is still there, above the newest');
  assert.equal(stacked[0].dataset.leaving, 'false');
  assert.ok(['interim', 'translating', 'final'].includes(stacked.at(-1)!.dataset.status ?? ''));

  await act(async () => {
    await sleep(2800); // the first line has now had its reading time
  });
  assert.ok(!overlayRows().some((r) => r.textContent?.includes(FIRST_TH)), 'after its reading time the first line has left the screen');
  assert.ok(text().includes(FIRST_TH), 'but it is still in the transcript history');
  assert.ok(text().includes('おはよう、今日はずいぶん早いね。'));

  // Selecting a source in an environment without display capture reports it, no crash
  await click(button('Select Window / Tab'));
  assert.ok(text().includes("This browser can't capture tab audio"));

  // Settings: segmented control updates state and storage; sample preview is labeled
  await click(button(/^Settings$/));
  assert.ok(text().includes('Sample text for styling') || text().includes('Live preview'));
  await click(button('Thai only'));
  assert.equal(JSON.parse(localStorage.getItem('kotoba-live:settings:v1')!).displayMode, 'thai');
  await click(Array.from(document.querySelectorAll('button[role="radio"]')).find((b) => b.textContent === 'Top'));
  assert.equal(JSON.parse(localStorage.getItem('kotoba-live:settings:v1')!).position, 'top');

  // New controls exist, work, and the live-text note is honest about how it is produced
  assert.ok(text().includes('Visible lines') && text().includes('Subtitle duration') && text().includes('Keep subtitles longer'));
  assert.ok(text().includes('re-transcribing'), 'must say the live text comes from repeated transcription');
  assert.ok(!/streams? live|real-time streaming/i.test(text()), 'must not claim true streaming');
  await click(document.querySelector('button[aria-label="Keep subtitles longer"]'));
  assert.equal(JSON.parse(localStorage.getItem('kotoba-live:settings:v1')!).keepLonger, true);

  // History: demo data is shown but not exportable; clear needs confirmation
  await click(button(/Subtitle History/));
  assert.ok(text().includes('Demo'));
  const exportBtn = button(/Export/);
  assert.ok(exportBtn?.disabled, 'demo rows must not be exportable');
  await click(button(/Clear history/));
  assert.ok(text().includes('Clear all subtitle history?'));
  await click(button('Keep history'));
  assert.ok(!text().includes('No subtitles yet'), 'cancel must keep history');
  await click(button(/Clear history/));
  const confirm = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Clear history').pop();
  await click(confirm);
  assert.ok(text().includes('No subtitles yet'), 'confirm must clear history');
}
