import { AlertTriangle, Info, OctagonAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useController, useControllerState } from '@/lib/controller-context';
import { cn } from '@/lib/utils';
import type { IssueAction } from '@/types';

const TONE = {
  error: { box: 'border-bad/30 bg-bad/10', icon: 'text-bad', Icon: OctagonAlert },
  warning: { box: 'border-warn/30 bg-warn/10', icon: 'text-warn', Icon: AlertTriangle },
  info: { box: 'border-azure/30 bg-azure/10', icon: 'text-azure', Icon: Info },
} as const;

const LABEL: Record<IssueAction, string> = {
  select: 'Select Window / Tab',
  'retry-server': 'Check again',
  reconnect: 'Reconnect',
  stop: 'Stop',
  demo: 'Try demo data',
  settings: 'Open settings',
};

export function IssueBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const controller = useController();
  const { issue } = useControllerState();
  if (!issue) return null;
  const tone = TONE[issue.severity];

  const run = (action: IssueAction) => {
    switch (action) {
      case 'select': return void controller.selectSource();
      case 'retry-server': return void controller.checkHealth();
      case 'reconnect': return void controller.reconnect();
      case 'stop': return void controller.stopListening();
      case 'demo': return controller.startDemo();
      case 'settings': return onOpenSettings();
    }
  };

  return (
    <div role={issue.severity === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-2xl border p-4', tone.box)}>
      <tone.Icon className={cn('mt-0.5 shrink-0', tone.icon)} size={20} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{issue.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{issue.message}</p>
        {issue.actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {issue.actions.map((a, i) => (
              <Button key={a} size="sm" variant={i === 0 ? 'secondary' : 'ghost'} onClick={() => run(a)}>
                {LABEL[a]}
              </Button>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={() => controller.dismissIssue()} aria-label="Dismiss" className="rounded-lg p-1 text-faint hover:bg-white/5 hover:text-fg">
        <X size={16} />
      </button>
    </div>
  );
}
