import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DashboardView } from '@/components/DashboardView';
import { HistoryList } from '@/components/HistoryList';
import { LiveView } from '@/components/LiveView';
import { SettingsView } from '@/components/SettingsView';
import { Sidebar, type View } from '@/components/Sidebar';
import { FloatingOverlay, PipView } from '@/components/SubtitleOverlay';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TranslatorController } from '@/lib/controller';
import { ControllerContext, useControllerState } from '@/lib/controller-context';
import { usePip } from '@/lib/pip';
import { useSettings } from '@/lib/settings';
import { useSubtitleQueue } from '@/lib/subtitleQueue';

function Shell({ controller }: { controller: TranslatorController }) {
  const { settings, update, reset } = useSettings();
  const { entries, health, demo } = useControllerState();
  const [view, setView] = useState<View>('live');

  useEffect(() => controller.setSettings(settings), [controller, settings]);

  // What is on screen is its own queue, separate from the history in `entries`.
  const rows = useSubtitleQueue(entries, {
    mode: settings.displayMode,
    showInterim: settings.showPartials,
    needsThai: demo || health?.translate.configured !== false,
    maxVisible: settings.overlayLines,
    durationScale: settings.overlayDuration,
    keepLonger: settings.keepLonger,
  });
  const pip = usePip(rows, settings);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full">
        <Sidebar view={view} onChange={setView} />
        <main className="min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
          {view === 'dashboard' && <DashboardView settings={settings} pipSupport={pip.support} go={setView} />}
          {view === 'live' && <LiveView settings={settings} update={update} rows={rows} pip={pip} go={setView} />}
          {view === 'history' && (
            <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
              <h1 className="text-2xl font-semibold tracking-tight">Subtitle History</h1>
              <HistoryList settings={settings} update={update} />
            </div>
          )}
          {view === 'settings' && <SettingsView settings={settings} update={update} reset={reset} rows={rows} />}
        </main>
      </div>

      <FloatingOverlay rows={rows} settings={settings} onClose={() => update({ overlayEnabled: false })} />
      {pip.pipWindow && createPortal(<PipView rows={rows} settings={settings} win={pip.pipWindow} />, pip.pipWindow.document.body)}
    </TooltipProvider>
  );
}

export default function App() {
  const controller = useMemo(() => new TranslatorController(), []);
  useEffect(() => {
    controller.init();
    return () => controller.dispose();
  }, [controller]);

  return (
    <ControllerContext.Provider value={controller}>
      <Shell controller={controller} />
    </ControllerContext.Provider>
  );
}
