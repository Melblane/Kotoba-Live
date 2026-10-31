import type { SubtitleEntry } from '@/types';

export type EntryAction =
  | { type: 'transcript'; key: string; order: number; text: string; final: boolean; stable?: number; startMs: number; endMs: number; session: number; at: number; demo?: boolean }
  | { type: 'translation'; key: string; text: string; final: boolean }
  | { type: 'translationFailed'; key: string }
  | { type: 'discard'; key: string }
  | { type: 'clear' }
  | { type: 'removeDemo' };

const MAX_ENTRIES = 5000;

function replaceAt(list: SubtitleEntry[], i: number, next: SubtitleEntry): SubtitleEntry[] {
  const copy = list.slice();
  copy[i] = next;
  return copy;
}

/** Inserts by spoken order, so a late response can never put a line in the wrong place. */
function insertSorted(list: SubtitleEntry[], entry: SubtitleEntry): SubtitleEntry[] {
  let i = list.length;
  while (i > 0 && list[i - 1].order > entry.order) i--;
  const next = list.slice(0, i).concat(entry, list.slice(i));
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}

/**
 * The full history. Server events are applied by id, so live text, final text and
 * translation all edit one row. Nothing here ever removes a finished line; what is on
 * screen at any moment is decided separately (see subtitleQueue.ts).
 */
export function entriesReducer(entries: SubtitleEntry[], a: EntryAction): SubtitleEntry[] {
  switch (a.type) {
    case 'transcript': {
      const i = entries.findIndex((e) => e.id === a.key);
      if (i === -1) {
        return insertSorted(entries, {
          id: a.key,
          session: a.session,
          order: a.order,
          ja: a.text,
          th: '',
          jaFinal: a.final,
          thFinal: false,
          thFailed: false,
          jaStable: a.final ? a.text.length : Math.min(a.stable ?? 0, a.text.length),
          startMs: a.startMs,
          endMs: a.endMs,
          wallTime: a.at,
          jaFinalAt: a.final ? a.at : null,
          demo: a.demo,
        });
      }
      const cur = entries[i];
      if (cur.jaFinal && !a.final) return entries; // a late live refresh must never overwrite final text
      return replaceAt(entries, i, {
        ...cur,
        ja: a.text,
        jaFinal: a.final,
        jaStable: a.final ? a.text.length : Math.min(a.stable ?? 0, a.text.length),
        startMs: a.startMs,
        endMs: a.endMs,
        jaFinalAt: a.final ? (cur.jaFinalAt ?? a.at) : null,
      });
    }
    case 'translation': {
      const i = entries.findIndex((e) => e.id === a.key);
      if (i === -1) return entries;
      const cur = entries[i];
      if (cur.thFinal && !a.final) return entries; // a late draft must never overwrite the final translation
      return replaceAt(entries, i, { ...cur, th: a.text, thFinal: a.final, thFailed: false });
    }
    case 'translationFailed': {
      const i = entries.findIndex((e) => e.id === a.key);
      if (i === -1 || entries[i].thFinal) return entries;
      return replaceAt(entries, i, { ...entries[i], thFailed: true });
    }
    case 'discard':
      // Only drop rows that never produced final text (live text that turned out to be noise).
      return entries.filter((e) => !(e.id === a.key && !e.jaFinal));
    case 'removeDemo':
      return entries.some((e) => e.demo) ? entries.filter((e) => !e.demo) : entries;
    case 'clear':
      return [];
  }
}
