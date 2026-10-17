'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useConsole } from './ConsoleProvider';

/**
 * The one way to hand something to the AI agent from a classic screen.
 * Quiet outline button with the agent's sparkle, so it reads as "AI" without
 * competing with the page's primary action. Renders nothing for people who
 * can't use the agent.
 */
export function AskAgentButton({
  command,
  children,
  className,
  size = 'sm',
  label,
  ...props
}: Omit<ButtonProps, 'onClick' | 'variant'> & {
  /** What to send to the agent. */
  command: string;
  /** Accessible name when the visible text is short (e.g. "Fix"). */
  label?: string;
}) {
  const { askAgent, can } = useConsole();
  if (!can('agent.use')) return null;
  const iconOnly = size === 'icon' || size === 'icon-sm' || size === 'icon-lg';
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      aria-label={label}
      title={iconOnly ? label : undefined}
      onClick={() => askAgent(command)}
      className={cn('hover:border-agent/50 hover:bg-agent-soft hover:text-agent-soft-foreground', className)}
      {...props}
    >
      <Sparkles className="text-agent" aria-hidden />
      {children}
    </Button>
  );
}
