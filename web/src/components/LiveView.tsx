import { PictureInPicture2 } from 'lucide-react';
import { HistoryList } from '@/components/HistoryList';
import { IssueBanner } from '@/components/IssueBanner';
import { SourcePanel } from '@/components/SourcePanel';
import { StatusPill } from '@/components/status';
import { SubtitleStage } from '@/components/SubtitleOverlay';
import { TranscriptPanels } from '@/components/TranscriptPanels';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useController, useControllerState } from '@/lib/controller-context';
import type { usePip } from '@/lib/pip';
import type { OverlayRow, Settings } from '@/types';
import type { View } from './Sidebar';

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  rows: OverlayRow[];
  pip: ReturnType<typeof usePip>;
  go: (view: View) => void;
}

export function LiveView({ settings, update, rows, pip, go }: Props) {
  const controller = useController();
  const { phase, entries, demo } = useControllerState();

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Japanese → Thai Live Translator</h1>
        <StatusPill phase={phase} />
      </header>

      <IssueBanner onOpenSettings={() => go('settings')} />

      {demo && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm">
          <span>
            <strong className="font-medium">Demo mode.</strong> These are sample lines, not your audio.
          </span>
          <Button size="sm" variant="ghost" onClick={() => controller.stopDemo()}>Stop demo</Button>
        </div>
      )}

      <SourcePanel />
      <TranscriptPanels entries={entries} mode={settings.displayMode} />

      <section className="panel p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Subtitle preview</h2>
            <p className="text-xs text-muted">Shows exactly what the overlay displays. Older lines stay above the newest until they have been readable long enough.</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Switch checked={settings.overlayEnabled} onCheckedChange={(v) => update({ overlayEnabled: v })} aria-label="In-app subtitle overlay" />
              In-app overlay
            </label>
            <Button size="sm" onClick={() => (pip.active ? pip.close() : void pip.open())} variant={pip.active ? 'primary' : 'secondary'}>
              <PictureInPicture2 size={16} />
              {pip.active ? 'Close PiP window' : 'Open PiP window'}
            </Button>
          </div>
        </div>

        <SubtitleStage rows={rows} settings={settings} />

        {pip.error && <p role="alert" className="mt-3 text-sm text-bad">{pip.error}</p>}
        <details className="mt-4 text-sm text-muted">
          <summary className="cursor-pointer select-none text-fg/90 hover:text-fg">Why can&apos;t subtitles float over my video tab?</summary>
          <div className="mt-2 space-y-2 leading-relaxed">
            <p>A website cannot draw on top of other tabs or desktop apps. That is a browser security rule, not a missing feature.</p>
            <p>
              {pip.support === 'document' && 'Open the PiP window: it is a real always-on-top window you can drag over your video, and it follows your subtitle settings.'}
              {pip.support === 'video' && 'Open the PiP window: this browser supports a small video-style window that stays on top. It follows your settings, but its size and position are controlled by the browser.'}
              {pip.support === 'none' && "This browser doesn't support Picture-in-Picture for subtitles, so only the in-app overlay is available here. Chrome or Edge give you the always-on-top window."}
            </p>
            <p>For subtitles drawn over any app, including full-screen games, a separate desktop (Electron) version would be needed.</p>
          </div>
        </details>
      </section>

      <HistoryList settings={settings} update={update} compact />
    </div>
  );
}
