import { AudioLines, History, LayoutDashboard, Settings as SettingsIcon } from 'lucide-react';
import { useControllerState } from '@/lib/controller-context';
import { cn } from '@/lib/utils';

export type View = 'dashboard' | 'live' | 'history' | 'settings';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'live', label: 'Live Translator', icon: AudioLines },
  { id: 'history', label: 'Subtitle History', icon: History },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
] as const;

function useConnection() {
  const { health, healthState, phase } = useControllerState();
  if (healthState === 'checking') return { tone: 'bg-faint', title: 'Checking server', sub: '' };
  if (healthState === 'offline') return { tone: 'bg-bad', title: 'Server offline', sub: 'Run npm run dev' };
  if (health && !health.stt.configured) return { tone: 'bg-warn', title: 'API keys missing', sub: 'Set them in .env' };
  const live = phase === 'listening' || phase === 'transcribing' || phase === 'translating';
  return { tone: live ? 'bg-ok animate-breathe' : 'bg-ok', title: live ? 'Streaming to server' : 'Server connected', sub: health ? health.stt.model : '' };
}

export function Sidebar({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const conn = useConnection();
  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-ink-900 p-4 md:flex">
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-iris to-azure font-jp text-lg font-bold text-white shadow-[0_6px_20px_-6px_rgba(110,120,255,0.9)]">言</div>
          <span className="text-lg font-semibold tracking-tight">Kotoba Live</span>
        </div>

        <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Main">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={view === id ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                view === id ? 'bg-ink-600 text-fg' : 'text-muted hover:bg-white/5 hover:text-fg',
              )}
            >
              <Icon size={18} className={view === id ? 'text-iris' : undefined} />
              {label}
            </button>
          ))}
        </nav>

        <div className="rounded-xl border bg-ink-800/70 p-3" role="status">
          <div className="flex items-center gap-2.5">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', conn.tone)} aria-hidden />
            <span className="text-sm font-medium">{conn.title}</span>
          </div>
          {conn.sub && <p className="mt-1 pl-[18px] text-xs text-faint">{conn.sub}</p>}
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-ink-900/95 backdrop-blur md:hidden" aria-label="Main">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={view === id ? 'page' : undefined}
            className={cn('flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px]', view === id ? 'text-iris' : 'text-muted')}
          >
            <Icon size={20} />
            {label.split(' ').pop()}
          </button>
        ))}
      </nav>
    </>
  );
}
