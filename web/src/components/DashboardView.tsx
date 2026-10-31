import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IssueBanner } from '@/components/IssueBanner';
import { StatusPill } from '@/components/status';
import { AudioCapture } from '@/lib/capture';
import { useController, useControllerState } from '@/lib/controller-context';
import type { PipSupport } from '@/lib/pip';
import { formatClock } from '@/lib/utils';
import type { Settings } from '@/types';
import type { View } from './Sidebar';

type CheckState = 'ok' | 'warn' | 'wait';

function Check({ state, title, children }: { state: CheckState; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {state === 'ok' && <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-ok" />}
      {state === 'warn' && <TriangleAlert size={20} className="mt-0.5 shrink-0 text-warn" />}
      {state === 'wait' && <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-faint" />}
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted">{children}</p>
      </div>
    </li>
  );
}

export function DashboardView({ settings, pipSupport, go }: { settings: Settings; pipSupport: PipSupport; go: (v: View) => void }) {
  const controller = useController();
  const { phase, health, healthState, entries, capturedMs } = useControllerState();
  const canCapture = AudioCapture.isSupported();
  const recent = entries.filter((e) => e.thFinal || e.jaFinal).slice(-3).reverse();
  const real = entries.filter((e) => !e.demo && e.jaFinal).length;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <StatusPill phase={phase} />
      </header>
      <IssueBanner onOpenSettings={() => go('settings')} />

      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-base font-semibold">Is everything ready?</h2>
          <ul className="mt-1 divide-y">
            <Check state={canCapture ? 'ok' : 'warn'} title="Tab audio capture">
              {canCapture ? 'This browser can capture audio from a tab you choose.' : 'Needs desktop Chrome or Edge. Firefox and Safari do not share tab audio.'}
            </Check>
            <Check state={healthState === 'ok' ? 'ok' : healthState === 'offline' ? 'warn' : 'wait'} title="Server">
              {healthState === 'ok' ? 'Connected.' : healthState === 'offline' ? 'Not reachable. Start it with npm run dev.' : 'Checking…'}
            </Check>
            <Check state={!health ? 'wait' : health.stt.configured ? 'ok' : 'warn'} title="Speech recognition">
              {!health ? 'Waiting for the server.' : health.stt.configured ? `${health.stt.model} via ${health.stt.provider}` : 'No API key. Set STT_API_KEY in .env and restart.'}
            </Check>
            <Check state={!health ? 'wait' : health.stt.interim === 'none' ? 'warn' : 'ok'} title="Live Japanese text">
              {!health
                ? 'Waiting for the server.'
                : health.stt.interim === 'rerun'
                  ? 'Refreshed about once a second by re-transcribing the sentence so far. The provider does not stream.'
                  : health.stt.interim === 'native'
                    ? 'Streamed by the provider.'
                    : 'Off on the server. Each line appears when its sentence ends.'}
            </Check>
            <Check state={!health ? 'wait' : health.translate.configured ? 'ok' : 'warn'} title="Translation">
              {!health ? 'Waiting for the server.' : health.translate.configured ? `${health.translate.model} via ${health.translate.provider}` : 'No API key. Set LLM_API_KEY in .env and restart.'}
            </Check>
            <Check state={pipSupport === 'none' ? 'warn' : 'ok'} title="Picture-in-Picture subtitles">
              {pipSupport === 'document' ? 'Full subtitle window supported.' : pipSupport === 'video' ? 'Supported through a video window with fewer options.' : 'Not supported here. The in-app overlay still works.'}
            </Check>
          </ul>
        </section>

        <div className="space-y-5">
          <section className="panel p-5">
            <h2 className="text-base font-semibold">Start translating</h2>
            <p className="mt-1 text-sm text-muted">
              Pick the tab with your Japanese video, and make sure &ldquo;Also share tab audio&rdquo; is ticked. Subtitles for {settings.sourceLang === 'ja' ? 'Japanese' : 'auto-detected'} speech appear in Thai within a couple of seconds.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  go('live');
                  void controller.startListening();
                }}
              >
                Select Window / Tab
              </Button>
              {healthState !== 'ok' || (health && !health.stt.configured) ? (
                <Button size="lg" onClick={() => { go('live'); controller.startDemo(); }}>Try demo data</Button>
              ) : null}
            </div>
            <p className="mt-4 text-sm text-faint">
              {real === 0 ? 'No subtitles yet.' : `${real} ${real === 1 ? 'subtitle' : 'subtitles'} so far.`}
              {capturedMs > 0 && ` Last run listened for ${formatClock(capturedMs)}.`}
            </p>
          </section>

          <section className="panel p-5">
            <h2 className="text-base font-semibold">Latest lines</h2>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing yet. Lines show up here as they are translated.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {recent.map((e) => (
                  <li key={e.id}>
                    <p lang="th" className="font-thai text-[17px] leading-relaxed">{e.th || e.ja}</p>
                    {e.th && <p lang="ja" className="font-jp text-sm text-muted">{e.ja}</p>}
                  </li>
                ))}
              </ul>
            )}
            <Button size="sm" variant="ghost" className="mt-3 -ml-3" onClick={() => go('history')}>Open full history</Button>
          </section>
        </div>
      </div>
    </div>
  );
}
