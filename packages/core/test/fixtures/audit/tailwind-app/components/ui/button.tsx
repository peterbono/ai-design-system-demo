import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva('inline-flex items-center rounded-md text-sm font-medium', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      destructive: 'bg-red-600 text-white',
    },
    size: { default: 'h-10 px-4 py-2', sm: 'h-[34px] px-3' },
  },
});

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function Button({ className, ...props }, ref) {
  return <button ref={ref} className={cn(buttonVariants(), className)} {...props} />;
});
