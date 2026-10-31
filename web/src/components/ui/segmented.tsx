import { cn } from '@/lib/utils';

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, label, className }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full flex-wrap rounded-xl border bg-ink-800 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn('rounded-lg px-3 py-1.5 text-sm transition-colors', active ? 'bg-ink-500 text-fg shadow' : 'text-muted hover:text-fg')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
