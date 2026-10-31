import { Captions, Check, Copy, Download, Files, Trash2 } from 'lucide-react';
import { Fragment, memo, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tooltip';
import { useController, useControllerState } from '@/lib/controller-context';
import { buildSrt, buildTxt, downloadText, hasExportable } from '@/lib/export';
import { cn, copyText, formatClock } from '@/lib/utils';
import type { DisplayMode, Settings, SubtitleEntry } from '@/types';

function CopyButton({ text, label, icon: Icon, disabled }: { text: string; label: string; icon: typeof Copy; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Tip label={disabled ? 'No translation yet' : done ? 'Copied' : label}>
      <span>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={label}
          disabled={disabled}
          onClick={async () => {
            if (await copyText(text)) {
              setDone(true);
              window.setTimeout(() => setDone(false), 1200);
            }
          }}
        >
          {done ? <Check size={16} className="text-ok" /> : <Icon size={16} />}
        </Button>
      </span>
    </Tip>
  );
}

const Row = memo(function Row({ entry: e, mode }: { entry: SubtitleEntry; mode: DisplayMode }) {
  const showJa = mode !== 'thai';
  const showTh = mode !== 'japanese';
  const waiting = !e.th && showTh && !e.thFailed;
  return (
    <li className="group grid grid-cols-[auto_1fr_auto] items-start gap-x-4 border-b px-5 py-3 last:border-b-0">
      <time className="w-[4.5rem] pt-1 text-xs tabular-nums text-faint" title={new Date(e.wallTime).toLocaleString()}>
        {formatClock(e.startMs)}
      </time>
      <div className="min-w-0">
        {showJa && (
          <p lang="ja" className={cn('font-jp break-words', showTh ? 'text-sm text-muted' : 'text-base text-fg', !e.jaFinal && 'opacity-70')}>
            {e.ja}
          </p>
        )}
        {showTh && (
          <p lang="th" className={cn('font-thai mt-0.5 break-words text-[17px] leading-relaxed', waiting ? 'animate-breathe text-faint' : 'text-fg', e.th && !e.thFinal && 'opacity-70')}>
            {e.th || (e.thFailed ? 'Translation unavailable' : e.jaFinal ? 'Translating…' : '…')}
          </p>
        )}
        {e.demo && <span className="mt-1 inline-block rounded-md bg-warn/15 px-1.5 py-0.5 text-xs text-warn">Demo</span>}
      </div>
      <div className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
        <CopyButton text={e.th} label="Copy Thai translation" icon={Copy} disabled={!e.th} />
        <CopyButton text={`${e.ja}\n${e.th}`} label="Copy Japanese and Thai" icon={Files} disabled={!e.th} />
      </div>
    </li>
  );
});

function ExportMenu({ entries }: { entries: SubtitleEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const can = hasExportable(entries);

  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => !ref.current?.contains(ev.target as Node) && setOpen(false);
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const items: Array<{ label: string; run: () => void }> = [
    { label: 'Text file (.txt)', run: () => downloadText(`kotoba-live-${stamp}.txt`, buildTxt(entries)) },
    { label: 'Subtitles, Thai (.srt)', run: () => downloadText(`kotoba-live-${stamp}-th.srt`, buildSrt(entries, 'thai'), 'application/x-subrip') },
    { label: 'Subtitles, Japanese and Thai (.srt)', run: () => downloadText(`kotoba-live-${stamp}-ja-th.srt`, buildSrt(entries, 'both'), 'application/x-subrip') },
    { label: 'Subtitles, Japanese (.srt)', run: () => downloadText(`kotoba-live-${stamp}-ja.srt`, buildSrt(entries, 'japanese'), 'application/x-subrip') },
  ];

  return (
    <div ref={ref} className="relative" title={can ? undefined : 'Nothing to export yet. Demo data is not exported.'}>
      <Button size="sm" disabled={!can} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download size={15} /> Export
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-64 rounded-xl border bg-ink-600 p-1 shadow-xl">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5"
              onClick={() => {
                it.run();
                setOpen(false);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoryList({ settings, update, compact = false }: { settings: Settings; update: (p: Partial<Settings>) => void; compact?: boolean }) {
  const controller = useController();
  const { entries } = useControllerState();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (settings.autoScroll && el) el.scrollTop = el.scrollHeight;
  }, [entries, settings.autoScroll]);

  let lastSession = -1;
  return (
    <section className="panel flex flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h2 className="text-base font-semibold">Subtitle history</h2>
          <p className="text-xs text-muted">{entries.length === 1 ? '1 line' : `${entries.length} lines`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <Switch checked={settings.autoScroll} onCheckedChange={(v) => update({ autoScroll: v })} aria-label="Auto-scroll to newest subtitle" />
            Auto-scroll
          </label>
          <ExportMenu entries={entries} />
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost" disabled={entries.length === 0}>
                <Trash2 size={15} /> Clear history
              </Button>
            }
            title="Clear all subtitle history?"
            description="This removes every recorded line from this page. Exported files you already saved are not affected. This can't be undone."
            confirmLabel="Clear history"
            cancelLabel="Keep history"
            onConfirm={() => controller.clearHistory()}
          />
        </div>
      </header>

      <div ref={scroller} className={cn('overflow-y-auto', compact ? 'max-h-80 min-h-[160px]' : 'min-h-[320px] max-h-[calc(100vh-15rem)]')}>
        {entries.length === 0 ? (
          <div className="grid place-items-center gap-2 px-6 py-14 text-center">
            <Captions className="text-faint" size={32} />
            <p className="font-medium">No subtitles yet</p>
            <p className="max-w-sm text-sm text-muted">Start listening and each line appears here with its timestamp, ready to copy or export.</p>
          </div>
        ) : (
          <ul>
            {entries.map((e) => {
              const header = e.session !== lastSession;
              lastSession = e.session;
              return (
                <Fragment key={e.id}>
                  {header && (
                    <li className="bg-ink-800/60 px-5 py-1.5 text-xs text-faint">
                      {e.demo ? 'Demo data' : `Session started ${new Date(e.wallTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </li>
                  )}
                  <Row entry={e} mode={settings.displayMode} />
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
