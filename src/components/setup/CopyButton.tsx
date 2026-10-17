'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, IconButton, type ButtonProps } from '@/components/ui/button';

/**
 * Copy text to the clipboard. `copied` flips on for two seconds after a
 * successful copy; a failure shows a toast telling people to select the text.
 */
export function useCopy(timeout = 2000) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = React.useCallback(
    async (text: string, failMessage = 'Couldn’t copy — select the text and copy it instead.') => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), timeout);
        return true;
      } catch {
        toast.error(failMessage);
        return false;
      }
    },
    [timeout]
  );
  return { copy, copied };
}

/**
 * A copy button that announces "Copied" to screen readers (aria-live) and
 * swaps its icon to a check for a moment. Give it `label` for the visible
 * text, or `iconOnly` with a `label` that names what is copied.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  iconOnly = false,
  variant = 'outline',
  size,
  className,
  onCopied,
}: {
  /** The text, or a function returning it at click time (e.g. to build a URL). */
  value: string | (() => string);
  label?: string;
  copiedLabel?: string;
  iconOnly?: boolean;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  onCopied?: () => void;
}) {
  const { copy, copied } = useCopy();
  const run = async () => {
    const ok = await copy(typeof value === 'function' ? value() : value);
    if (ok) onCopied?.();
  };
  const icon = copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />;
  return (
    <>
      {iconOnly ? (
        <IconButton label={label} variant={variant === 'outline' ? 'ghost' : variant} size={size ?? 'icon-sm'} className={className} onClick={run}>
          {icon}
        </IconButton>
      ) : (
        <Button type="button" variant={variant} size={size ?? 'sm'} className={cn('min-w-0', className)} onClick={run}>
          {icon}
          <span>{copied ? copiedLabel : label}</span>
        </Button>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </>
  );
}
