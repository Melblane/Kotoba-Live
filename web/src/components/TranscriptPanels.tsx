import { cn } from '@/lib/utils';
import type { DisplayMode, SubtitleEntry } from '@/types';

interface Line {
  id: string;
  text: string;
  partial: boolean;
  pending: boolean;
  /** For live text: how much of it survived the last refresh unchanged. */
  stable?: number;
}

function LivePanel({ title, tag, lang, lines, empty, live }: { title: string; tag: string; lang: 'ja' | 'th'; lines: Line[]; empty: string; live?: boolean }) {
  return (
    <section className="panel flex min-h-[220px] flex-col p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-faint">{tag}</span>
      </header>
      <div className="flex flex-1 flex-col justify-end gap-2.5" aria-live={live ? 'polite' : undefined}>
        {lines.length === 0 && <p className="my-auto text-sm text-faint">{empty}</p>}
        {lines.map((l, i) => {
          const newest = i === lines.length - 1;
          return (
            <p
              key={l.id}
              lang={lang}
              className={cn(
                'animate-rise break-words transition-opacity',
                lang === 'th' ? 'font-thai leading-relaxed' : 'font-jp leading-relaxed',
                newest ? 'text-2xl font-medium text-fg' : 'text-base text-muted',
                !newest && (i === lines.length - 2 ? 'opacity-70' : 'opacity-40'),
                l.partial && 'text-fg/75',
                l.pending && 'animate-breathe text-faint',
              )}
            >
              {l.partial && l.stable !== undefined ? (
                <>
                  <span>{l.text.slice(0, l.stable)}</span>
                  <span className="opacity-60">{l.text.slice(l.stable)}</span>
                </>
              ) : (
                l.text
              )}
              {l.partial && !l.pending && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-iris align-middle animate-breathe" aria-label="still listening" />}
            </p>
          );
        })}
      </div>
    </section>
  );
}

export function TranscriptPanels({ entries, mode }: { entries: SubtitleEntry[]; mode: DisplayMode }) {
  const recent = entries.slice(-4);
  const ja: Line[] = recent.filter((e) => e.ja).map((e) => ({ id: e.id, text: e.ja, partial: !e.jaFinal, pending: false, stable: e.jaStable }));
  const th: Line[] = recent
    .filter((e) => e.th || e.jaFinal)
    .map((e) => ({ id: e.id, text: e.th || (e.thFailed ? 'Translation unavailable' : 'Translating…'), partial: Boolean(e.th) && !e.thFinal, pending: !e.th && !e.thFailed }));

  return (
    <div className={cn('grid gap-4', mode === 'both' && 'md:grid-cols-2')}>
      {mode !== 'thai' && <LivePanel title="Japanese Original" tag="日本語" lang="ja" lines={ja} empty="Waiting for Japanese speech" />}
      {mode !== 'japanese' && <LivePanel title="Thai Translation" tag="ไทย" lang="th" lines={th} empty="Thai subtitles appear here" live />}
    </div>
  );
}
