// A small browser environment for tests: jsdom plus a mocked server health endpoint and a
// timer tracker, so tests can prove that nothing is left running after cleanup.
import { JSDOM } from 'jsdom';

export const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/', pretendToBeVisual: true });
export const win = dom.window as unknown as Window & Record<string, unknown>;

for (const key of Object.getOwnPropertyNames(win)) {
  if (key in globalThis) continue;
  try {
    Object.defineProperty(globalThis, key, { configurable: true, get: () => win[key] });
  } catch {
    /* some window properties cannot be redefined; they are not needed */
  }
}
Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: win.localStorage });
// Node ships its own Event/CustomEvent; DOM nodes only accept jsdom's.
for (const name of ['Event', 'CustomEvent', 'EventTarget'] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: win[name] });
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
win.ResizeObserver = ResizeObserverStub;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- timer tracking: every timer the app creates through `window` is recorded until it fires or is cleared
export const liveTimers = new Set<number>();
const w = win as unknown as Record<string, (...a: unknown[]) => number | void>;
const rawSetTimeout = w.setTimeout.bind(win);
const rawSetInterval = w.setInterval.bind(win);
const rawClearTimeout = w.clearTimeout.bind(win);
const rawClearInterval = w.clearInterval.bind(win);
w.setTimeout = (fn: unknown, ms: unknown, ...args: unknown[]) => {
  const id = rawSetTimeout(() => {
    liveTimers.delete(id as number);
    (fn as (...a: unknown[]) => void)(...args);
  }, ms) as number;
  liveTimers.add(id);
  return id;
};
w.setInterval = (fn: unknown, ms: unknown, ...args: unknown[]) => {
  const id = rawSetInterval(fn, ms, ...args) as number;
  liveTimers.add(id);
  return id;
};
w.clearTimeout = (id: unknown) => {
  liveTimers.delete(id as number);
  rawClearTimeout(id);
};
w.clearInterval = (id: unknown) => {
  liveTimers.delete(id as number);
  rawClearInterval(id);
};

// ---- the server's health endpoint
export const health = {
  ok: true, version: '1.0.0', authRequired: false, partials: true,
  stt: { configured: false, provider: 'api.openai.com', model: 'whisper-1', streaming: false, interim: 'rerun' },
  translate: { configured: false, provider: 'api.openai.com', model: 'gpt-4o-mini' },
};
globalThis.fetch = (async () => new Response(JSON.stringify(health), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
