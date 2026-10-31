import type { DisplayMode, SubtitleEntry } from '@/types';
import { formatClock } from './utils';

export function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(t % 1000, 3)}`;
}

const isReady = (e: SubtitleEntry, mode: DisplayMode): boolean => !e.demo && (mode === 'japanese' ? e.jaFinal : e.thFinal);

/**
 * SRT cues. Capture sessions each start their clock at zero, so later sessions are shifted
 * to begin after the previous one and cues never overlap.
 */
export function buildSrt(entries: SubtitleEntry[], mode: DisplayMode): string {
  const usable = entries.filter((e) => isReady(e, mode));
  const offsets = new Map<number, number>();
  let cursor = 0;
  let session: number | null = null;
  let sessionEnd = 0;
  for (const e of usable) {
    if (e.session !== session) {
      if (session !== null) cursor += sessionEnd + 2000;
      session = e.session;
      sessionEnd = 0;
      offsets.set(e.session, cursor);
    }
    sessionEnd = Math.max(sessionEnd, e.endMs, e.startMs);
  }

  const cues = usable.map((e) => {
    const base = offsets.get(e.session) ?? 0;
    const start = base + e.startMs;
    const end = base + Math.max(e.endMs, e.startMs + 800);
    const body = mode === 'both' ? `${e.ja}\n${e.th}` : mode === 'japanese' ? e.ja : e.th;
    return { start, end, body };
  });
  cues.forEach((c, i) => {
    const next = cues[i + 1];
    if (next && c.end > next.start - 10) c.end = Math.max(c.start + 300, next.start - 10);
  });
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.body}\n`).join('\n');
}

export function buildTxt(entries: SubtitleEntry[]): string {
  const rows = entries.filter((e) => !e.demo && (e.jaFinal || e.thFinal));
  let session: number | null = null;
  const out: string[] = [];
  for (const e of rows) {
    if (e.session !== session) {
      session = e.session;
      out.push(`--- Session started ${new Date(e.wallTime).toLocaleString()} ---`, '');
    }
    out.push(`[${formatClock(e.startMs)}] ${e.ja}`);
    if (e.th) out.push(`           ${e.th}`);
    out.push('');
  }
  return out.join('\n');
}

export function hasExportable(entries: SubtitleEntry[]): boolean {
  return entries.some((e) => !e.demo && (e.jaFinal || e.thFinal));
}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
