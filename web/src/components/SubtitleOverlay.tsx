import { Moon, Sun, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { makeSampleRows } from '@/lib/demo';
import { useElementSize, useViewportSize } from '@/lib/size';
import { fitRows } from '@/lib/subtitleQueue';
import { cn } from '@/lib/utils';
import type { OverlayRow, Settings } from '@/types';

/**
 * Slides existing rows to their new position when the stack changes (a line was added above,
 * or one left). Uses the Web Animations API on `transform` only, so it runs on the compositor
 * and cannot interfere with transcription. Skipped when the user prefers reduced motion.
 */
function useFlip(ref: RefObject<HTMLElement>) {
  const previous = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = root.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const next = new Map<string, number>();
    root.querySelectorAll<HTMLElement>('[data-subtitle-row]').forEach((el) => {
      const id = el.dataset.subtitleRow as string;
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const before = previous.current.get(id);
      if (!reduce && before !== undefined && Math.abs(before - top) > 1 && typeof el.animate === 'function') {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
    previous.current = next;
  });
}

function RowView({ row, settings, depth }: { row: OverlayRow; settings: Settings; depth: number }) {
  const settled = row.status !== 'interim';
  // Older lines sit slightly dimmer so the newest one reads first. Live text is dimmer still.
  const fade = (depth === 0 ? 1 : depth === 1 ? 0.85 : depth === 2 ? 0.7 : 0.58) * (settled ? 1 : 0.78);
  const style = { color: settings.textColor, background: `rgba(8,9,14,${settings.bgOpacity / 100})`, '--row-opacity': fade } as CSSProperties;
  const showThLine = row.showTh && (row.th.length > 0 || row.status === 'translating');

  return (
    <div
      data-subtitle-row={row.id}
      data-status={row.status}
      data-leaving={row.leaving}
      className="subtitle-row subtitle-shadow max-w-[92%] rounded-[0.4em] px-[0.7em] py-[0.3em] text-center"
      style={style}
    >
      {row.showJa && row.ja && (
        <p lang="ja" className="font-jp font-medium" style={{ fontSize: row.showTh ? '0.62em' : '1em', lineHeight: 1.4, opacity: row.showTh ? 0.88 : 1 }}>
          {settled ? (
            row.ja
          ) : (
            <>
              <span>{row.ja.slice(0, row.stable)}</span>
              <span className="opacity-60">{row.ja.slice(row.stable)}</span>
            </>
          )}
        </p>
      )}
      {showThLine && (
        <p lang="th" className="font-thai font-medium" style={{ lineHeight: 1.5 }}>
          {row.th || <span className="animate-breathe">…</span>}
        </p>
      )}
    </div>
  );
}

interface StackProps {
  rows: OverlayRow[];
  settings: Settings;
  /** CSS font size for the newest row, in whatever unit suits the surface. */
  fontSize: string;
  /** The same size in pixels, used only to decide how many rows fit. */
  fontPx: number;
  availableHeight: number;
}

/** The subtitle stack: newest line at the bottom, older lines above it. Rows are keyed by id and updated in place. */
export function SubtitleStack({ rows, settings, fontSize, fontPx, availableHeight }: StackProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref);
  const fit = fitRows({
    availableHeight,
    fontPx,
    showJa: settings.displayMode !== 'thai',
    showTh: settings.displayMode !== 'japanese',
    maxRows: settings.overlayLines,
  });
  const visible = rows.slice(-fit);
  return (
    <div ref={ref} className="flex flex-col items-center gap-[0.3em]" style={{ fontSize }}>
      {visible.map((row, i) => (
        <RowView key={row.id} row={row} settings={settings} depth={visible.length - 1 - i} />
      ))}
    </div>
  );
}

const STAGE_BG = {
  dark: 'radial-gradient(60% 85% at 22% 18%, #3b407e 0%, transparent 62%), radial-gradient(55% 75% at 82% 82%, #1d5876 0%, transparent 66%), #0f1119',
  bright: 'radial-gradient(60% 85% at 28% 22%, #fff4d2 0%, transparent 62%), radial-gradient(55% 75% at 80% 78%, #b4d9ff 0%, transparent 66%), #e8ebf2',
};

/** A 16:7 preview scaled as if the screen were 1280 px wide, with a backdrop switch to check legibility. */
export function SubtitleStage({ rows, settings, sample = false, className }: { rows: OverlayRow[]; settings: Settings; sample?: boolean; className?: string }) {
  const [bright, setBright] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const size = useElementSize(frame);
  const showSample = sample && rows.length === 0;
  const sampleRows = useMemo(() => makeSampleRows(settings.displayMode), [settings.displayMode]);
  const shown = showSample ? sampleRows : rows;
  const pos = settings.position === 'top' ? 'top-[4cqw]' : settings.position === 'bottom' ? 'bottom-[4cqw]' : 'top-1/2 -translate-y-1/2';

  return (
    <div className={cn('overflow-hidden rounded-2xl border', className)} style={{ containerType: 'inline-size' }}>
      <div ref={frame} className="relative aspect-[16/7] w-full" style={{ background: STAGE_BG[bright ? 'bright' : 'dark'] }}>
        {shown.length > 0 ? (
          <div className={cn('absolute inset-x-0 flex justify-center', pos)}>
            <SubtitleStack
              rows={shown}
              settings={settings}
              fontSize={`${((settings.fontSize / 1280) * 100).toFixed(3)}cqw`}
              fontPx={(size.width * settings.fontSize) / 1280}
              availableHeight={size.height * 0.92}
            />
          </div>
        ) : (
          <p className={cn('absolute inset-0 grid place-items-center text-sm', bright ? 'text-black/50' : 'text-white/50')}>Subtitles appear here</p>
        )}
        {showSample && <span className="absolute left-3 top-3 rounded-md bg-black/45 px-2 py-1 text-xs text-white/85">Sample text for styling</span>}
        <button
          type="button"
          onClick={() => setBright((b) => !b)}
          aria-label={bright ? 'Preview on a dark backdrop' : 'Preview on a bright backdrop'}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-black/45 text-white/85 transition-colors hover:bg-black/65"
        >
          {bright ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>
    </div>
  );
}

/** In-app floating overlay. Lines are removed by the queue (after their reading time, with a fade), not here. */
export function FloatingOverlay({ rows, settings, onClose }: { rows: OverlayRow[]; settings: Settings; onClose: () => void }) {
  const viewport = useViewportSize();
  if (!settings.overlayEnabled || rows.length === 0) return null;
  const pos = settings.position === 'top' ? 'top-6' : settings.position === 'center' ? 'top-1/2 -translate-y-1/2' : 'bottom-24 md:bottom-10';
  const fontPx = Math.min(settings.fontSize, viewport.width * 0.065);
  return (
    <div className={cn('pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4', pos)}>
      <div className="group pointer-events-auto relative max-w-full">
        <SubtitleStack rows={rows} settings={settings} fontSize={`${fontPx}px`} fontPx={fontPx} availableHeight={viewport.height * 0.46} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide subtitle overlay"
          className="absolute -right-2 -top-2 hidden h-6 w-6 place-items-center rounded-full bg-ink-600 text-fg shadow group-hover:grid group-focus-within:grid"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/** Content of the Picture-in-Picture window. */
export function PipView({ rows, settings, win }: { rows: OverlayRow[]; settings: Settings; win: Window }) {
  const viewport = useViewportSize(win);
  const align = settings.position === 'top' ? 'items-start' : settings.position === 'center' ? 'items-center' : 'items-end';
  const fontPx = Math.min(settings.fontSize, viewport.width * 0.07);
  return (
    <div className={cn('flex h-screen w-screen justify-center overflow-hidden bg-black p-3', align)}>
      {rows.length > 0 ? (
        <SubtitleStack rows={rows} settings={settings} fontSize={`${fontPx}px`} fontPx={fontPx} availableHeight={viewport.height - 24} />
      ) : (
        <p className="self-center text-sm text-white/50">Waiting for speech…</p>
      )}
    </div>
  );
}
