import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-[background-color,filter,opacity] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'bg-gradient-to-br from-iris to-azure text-white shadow-[0_8px_28px_-10px_rgba(110,120,255,0.85)] hover:brightness-110 active:brightness-95',
        secondary: 'border bg-ink-600 text-fg hover:bg-ink-500',
        ghost: 'text-muted hover:bg-white/5 hover:text-fg',
        danger: 'border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-[15px]', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
