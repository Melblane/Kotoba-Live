import { useEffect, useMemo, useRef, useState } from 'react';
import type { DisplayMode, OverlayRow, SubtitleEntry, SubtitleStatus } from '@/types';

/** How long a line fades out before it is removed. */
export const FADE_MS = 320;
/** A finished line is never pushed off by newer ones before it has been readable this long. */
export const MIN_SHOW_MS = 2000;
/** If Thai never arrives (a lost request), stop waiting and let the line expire normally. */
export const LOST_TRANSLATION_MS = 15_000;
const SCAN = 24;

export interface QueueOptions {
  mode: DisplayMode;
  /** Show Japanese while it is still being transcribed. */
  showInterim: boolean;
  /** False when the server has no translator: Japanese is then all there will ever be. */
  needsThai: boolean;
  maxVisible: number;
  durationScale: number;
  keepLonger: boolean;
}

interface Meta {
  /** When the line became complete. Its reading time starts here, not while it is still being translated. */
  readyAt: number | null;
  leavingAt: number | null;
  expired: boolean;
}

const wantsThai = (o: QueueOptions) => o.mode !== 'japanese' && o.needsThai;

export function entryStatus(e: SubtitleEntry, o: QueueOptions, now: number): Exclude<SubtitleStatus, 'expired'> {
  if (!e.jaFinal) return 'interim';
  if (!wantsThai(o) || e.thFinal || e.thFailed) return 'final';
  if (e.jaFinalAt !== null && now - e.jaFinalAt > LOST_TRANSLATION_MS) return 'final';
  return 'translating';
}

function layout(e: SubtitleEntry, o: QueueOptions): { showJa: boolean; showTh: boolean } {
  const showTh = wantsThai(o);
  // Thai-only users still get the Japanese if there is no Thai to show.
  const showJa = o.mode !== 'thai' || !o.needsThai || (e.thFailed && !e.th);
  return { showJa, showTh };
}

function displayable(e: SubtitleEntry, status: Exclude<SubtitleStatus, 'expired'>, o: QueueOptions): boolean {
  const { showJa, showTh } = layout(e, o);
  const hasJa = showJa && e.ja.length > 0;
  const hasTh = showTh && e.th.length > 0;
  if (status === 'interim') return o.showInterim && (hasJa || hasTh);
  return hasJa || hasTh;
}

/** Reading time scales with how much there is to read: about 3 to 5 s when short, up to 9 s when long. */
export function readingMs(e: SubtitleEntry, o: QueueOptions): number {
  const { showJa, showTh } = layout(e, o);
  let ms = 1500;
  if (showTh) ms += e.th.length * 70;
  if (showJa) ms += e.ja.length * (showTh ? 25 : 130);
  ms = Math.min(9000, Math.max(3000, ms)) * o.durationScale;
  if (o.keepLonger) ms *= 3;
  return Math.min(ms, o.keepLonger ? 30_000 : 15_000);
}

export interface QueueView {
  rows: OverlayRow[];
  /** When the queue next needs to be recomputed, or null if nothing is waiting on a clock. */
  nextWakeAt: number | null;
}

/**
 * What is on screen, kept apart from the history. The history holds every line forever;
 * this decides which of the latest ones are still visible and for how long. A new line
 * never removes an older one. Older lines leave only when their reading time is up (or the
 * screen is full), and they fade out before they go.
 */
export class SubtitleQueue {
  private readonly meta = new Map<string, Meta>();

  update(entries: SubtitleEntry[], o: QueueOptions, now: number): QueueView {
    const seen = new Set<string>();
    const live: Array<{ e: SubtitleEntry; m: Meta; status: Exclude<SubtitleStatus, 'expired'> }> = [];

    for (let i = Math.max(0, entries.length - SCAN); i < entries.length; i++) {
      const e = entries[i];
      seen.add(e.id);
      let m = this.meta.get(e.id);
      if (!m) this.meta.set(e.id, (m = { readyAt: null, leavingAt: null, expired: false }));
      if (m.expired) continue;

      const status = entryStatus(e, o, now);
      if (status === 'final' && m.readyAt === null) m.readyAt = now;
      if (!displayable(e, status, o)) continue;

      if (m.readyAt !== null && m.leavingAt === null && now >= m.readyAt + readingMs(e, o)) m.leavingAt = now;
      if (m.leavingAt !== null && now >= m.leavingAt + FADE_MS) {
        m.expired = true;
        continue;
      }
      live.push({ e, m, status });
    }
    for (const id of this.meta.keys()) if (!seen.has(id)) this.meta.delete(id);

    // The screen is full: let the oldest finished lines go, but never the newest, and never
    // before they have had a fair chance to be read.
    const active = live.filter((x) => x.m.leavingAt === null);
    let over = active.length - o.maxVisible;
    for (let i = 0; i < active.length - 1 && over > 0; i++) {
      const { m } = active[i];
      if (m.readyAt === null) continue;
      if (now - m.readyAt >= MIN_SHOW_MS || over > 1) {
        m.leavingAt = now;
        over--;
      }
    }

    let wake = Infinity;
    const note = (t: number) => {
      if (t > now) wake = Math.min(wake, t);
    };
    const rows: OverlayRow[] = live.map(({ e, m, status }) => {
      if (m.leavingAt !== null) note(m.leavingAt + FADE_MS);
      else if (m.readyAt !== null) {
        note(m.readyAt + readingMs(e, o));
        if (active.length > o.maxVisible) note(m.readyAt + MIN_SHOW_MS);
      } else if (status === 'translating' && e.jaFinalAt !== null) note(e.jaFinalAt + LOST_TRANSLATION_MS + 1);
      return { id: e.id, ja: e.ja, th: e.th, stable: status === 'interim' ? e.jaStable : e.ja.length, status, leaving: m.leavingAt !== null, ...layout(e, o) };
    });
    return { rows, nextWakeAt: Number.isFinite(wake) ? wake : null };
  }
}

/** One queue for the whole app, with one timer that sleeps until something actually has to change. */
export function useSubtitleQueue(entries: SubtitleEntry[], o: QueueOptions): OverlayRow[] {
  const queue = useRef<SubtitleQueue | null>(null);
  queue.current ??= new SubtitleQueue();
  const [tick, setTick] = useState(0);

  const view = useMemo(
    () => (queue.current as SubtitleQueue).update(entries, o, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `o` is rebuilt every render; only its fields matter
    [entries, o.mode, o.showInterim, o.needsThai, o.maxVisible, o.durationScale, o.keepLonger, tick],
  );

  useEffect(() => {
    if (view.nextWakeAt === null) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), Math.max(30, view.nextWakeAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [view]);

  return view.rows;
}

// ---- how many rows fit -----------------------------------------------------------------------

export function rowHeightPx(fontPx: number, showJa: boolean, showTh: boolean): number {
  const lines = (showTh ? 1.5 : 0) + (showJa ? (showTh ? 0.62 * 1.4 : 1.4) : 0);
  return fontPx * (lines + 0.6) + 6;
}

/** Rows that fit in the space given, so the stack never grows over most of the video. */
export function fitRows(o: { availableHeight: number; fontPx: number; showJa: boolean; showTh: boolean; maxRows: number }): number {
  if (!(o.availableHeight > 0) || !(o.fontPx > 0)) return o.maxRows;
  const per = rowHeightPx(o.fontPx, o.showJa, o.showTh);
  return Math.max(1, Math.min(o.maxRows, Math.floor(o.availableHeight / per)));
}
