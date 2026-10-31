import { useEffect, useState } from 'react';
import { useController } from '@/lib/controller-context';
import { cn } from '@/lib/utils';
import type { Phase } from '@/types';

export type StatusLabel = 'Idle' | 'Connecting' | 'Listening' | 'Processing' | 'Error';

export function describePhase(phase: Phase): { label: StatusLabel; detail: string } {
  switch (phase) {
    case 'idle': return { label: 'Idle', detail: 'Ready to start' };
    case 'ready': return { label: 'Idle', detail: 'Source selected, ready to start' };
    case 'selecting': return { label: 'Connecting', detail: 'Waiting for source selection' };
    case 'connecting': return { label: 'Connecting', detail: 'Connecting to the server' };
    case 'listening': return { label: 'Listening', detail: 'Listening for Japanese speech' };
    case 'transcribing': return { label: 'Processing', detail: 'Transcribing speech' };
    case 'translating': return { label: 'Processing', detail: 'Translating to Thai' };
    case 'stopping': return { label: 'Processing', detail: 'Finishing the last line' };
    case 'error': return { label: 'Error', detail: 'Needs attention' };
  }
}

const DOT: Record<StatusLabel, string> = {
  Idle: 'bg-faint',
  Connecting: 'bg-warn animate-breathe',
  Listening: 'bg-ok animate-breathe',
  Processing: 'bg-azure animate-breathe',
  Error: 'bg-bad',
};

export function StatusPill({ phase, className }: { phase: Phase; className?: string }) {
  const { label, detail } = describePhase(phase);
  return (
    <div role="status" className={cn('inline-flex items-center gap-2.5 rounded-full border bg-ink-700/80 py-1.5 pl-3 pr-4 text-sm', className)}>
      <span className={cn('h-2 w-2 rounded-full', DOT[label])} aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="hidden text-muted sm:inline">{detail}</span>
    </div>
  );
}

const BAR_COUNT = 32;

/** Live input level, fed straight from the audio worklet so it reflects what is really captured. */
export function LevelMeter({ active }: { active: boolean }) {
  const controller = useController();
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(0));

  useEffect(() => {
    if (!active) {
      setBars(Array(BAR_COUNT).fill(0));
      return;
    }
    let last = 0;
    return controller.onLevel((rms) => {
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      setBars((b) => [...b.slice(1), Math.min(1, Math.sqrt(rms) * 2.4)]);
    });
  }, [controller, active]);

  return (
    <div className="flex h-9 items-center gap-[3px]" role="img" aria-label={active ? 'Live audio level' : 'No audio source'}>
      {bars.map((b, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-gradient-to-t from-iris to-azure transition-[height] duration-75"
          style={{ height: `${Math.max(10, b * 100)}%`, opacity: 0.3 + b * 0.7 }}
        />
      ))}
    </div>
  );
}
