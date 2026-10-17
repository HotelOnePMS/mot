'use client';

import { LayoutDashboard, Sparkles } from 'lucide-react';
import type { InterfaceMode } from '@/lib/dto';
import { cn } from '@/lib/utils';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented';
import { useConsole } from './ConsoleProvider';

/**
 * The Classic ⇄ Agentic switch. Personal and instant: it changes how *you*
 * work right now. Owners/managers set the property default in Settings.
 * Only the Agentic side wears the agent's colours; Classic stays neutral.
 */
export function ModeSwitch({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const { mode, setMode, can } = useConsole();
  if (!can('agent.use')) return null;
  const agentic = mode === 'AGENTIC';
  const options: SegmentedOption<InterfaceMode>[] = [
    { value: 'CLASSIC', label: 'Classic', icon: <LayoutDashboard aria-hidden /> },
    {
      value: 'AGENTIC',
      label: <span className={agentic ? 'text-agent-gradient-foreground' : undefined}>Agentic</span>,
      icon: <Sparkles aria-hidden className={agentic ? 'text-agent-gradient-foreground' : 'text-agent'} />,
      activeClassName: 'bg-aurora motion-safe:animate-aurora shadow-glow ring-0',
    },
  ];
  return (
    <SegmentedControl
      aria-label="Interface mode"
      layoutId={`console-mode-${size}`}
      size={size}
      value={mode}
      onChange={(m) => setMode(m)}
      options={options}
      className={cn(className)}
    />
  );
}
