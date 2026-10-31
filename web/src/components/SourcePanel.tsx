import { MonitorUp, Play, Square } from 'lucide-react';
import { LevelMeter } from '@/components/status';
import { Button } from '@/components/ui/button';
import { useController, useControllerState } from '@/lib/controller-context';
import { formatClock } from '@/lib/utils';

const SURFACE = { browser: 'Browser tab', window: 'Application window', monitor: 'Entire screen', unknown: 'Shared source' } as const;

export function SourcePanel() {
  const controller = useController();
  const { phase, source, capturedMs, health, healthState, demo } = useControllerState();
  const streaming = phase === 'connecting' || phase === 'listening' || phase === 'transcribing' || phase === 'translating';
  const busy = phase === 'selecting' || phase === 'stopping';
  const setupNeeded = healthState === 'offline' || (health !== null && !health.stt.configured);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-iris/25 to-azure/20 text-iris">
            <MonitorUp size={26} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{source ? `${SURFACE[source.surface]} shared` : 'No source selected'}</h2>
            <p className="mt-0.5 max-w-prose text-sm text-muted">
              {source
                ? 'Audio is being captured. Play something in the shared tab and the level below should move.'
                : 'Pick a browser tab, window or screen in the browser dialog. Only what you choose is captured, and you can stop at any time.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={() => void controller.selectSource()} disabled={busy}>
            <MonitorUp size={18} />
            {streaming || source ? 'Change source' : 'Select Window / Tab'}
          </Button>
          {streaming ? (
            <Button size="lg" variant="danger" onClick={() => void controller.stopListening()}>
              <Square size={16} fill="currentColor" />
              Stop Listening
            </Button>
          ) : (
            <Button size="lg" variant="primary" onClick={() => void controller.startListening()} disabled={busy}>
              <Play size={16} fill="currentColor" />
              {phase === 'stopping' ? 'Finishing…' : 'Start Listening'}
            </Button>
          )}
        </div>
      </div>

      {(source || demo || setupNeeded) && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t bg-ink-800/40 px-5 py-3 md:px-6">
          {source ? (
            <div className="flex items-center gap-4">
              <LevelMeter active />
              <span className="text-sm tabular-nums text-muted">{streaming ? formatClock(capturedMs) : 'Not listening yet'}</span>
            </div>
          ) : (
            <span className="text-sm text-muted">{demo ? 'Demo data is playing. It is not your audio.' : 'Live capture needs the server and an API key.'}</span>
          )}
          {!source && (demo ? (
            <Button size="sm" variant="ghost" onClick={() => controller.stopDemo()}>Stop demo</Button>
          ) : setupNeeded ? (
            <Button size="sm" variant="ghost" onClick={() => controller.startDemo()}>Try demo data</Button>
          ) : null)}
        </div>
      )}
    </section>
  );
}
