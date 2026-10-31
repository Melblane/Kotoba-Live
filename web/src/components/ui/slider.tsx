import * as SliderPrimitive from '@radix-ui/react-slider';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Slider({ className, label, ...props }: ComponentProps<typeof SliderPrimitive.Root> & { label: string }) {
  return (
    <SliderPrimitive.Root className={cn('relative flex h-5 w-full touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-ink-500">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-gradient-to-r from-iris to-azure" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label={label} className="block h-4 w-4 rounded-full bg-white shadow ring-2 ring-iris/50 transition-shadow hover:ring-4" />
    </SliderPrimitive.Root>
  );
}
