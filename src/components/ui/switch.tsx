'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useFieldControl } from '@/components/ui/field-context';

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type' | 'aria-checked' | 'children'>;

/**
 * Accessible on/off switch (button role="switch").
 * The off track uses the 3:1 control boundary colour; the invisible hit
 * area is 44px tall without changing the 24px visual or the layout.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
  onClick,
  ...rest
}: SwitchProps) {
  const a11y = useFieldControl({ id, 'aria-describedby': rest['aria-describedby'], 'aria-invalid': rest['aria-invalid'] });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      {...rest}
      {...a11y}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? 'bg-primary' : 'bg-border-strong hover:bg-foreground/50',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none inline-block size-5 rounded-full shadow-soft transition-transform duration-150',
          checked ? 'translate-x-[22px] bg-primary-foreground' : 'translate-x-0.5 bg-surface'
        )}
      />
    </button>
  );
}
