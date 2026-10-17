'use client';

import { useEffect } from 'react';
import { AgentWorkspace } from '@/components/agent/AgentWorkspace';
import { useConsole } from '@/components/console/ConsoleProvider';

export default function AgentPage() {
  const { preferredMode, setMode, can } = useConsole();
  // Working in the agent makes it your default landing surface.
  useEffect(() => {
    if (can('agent.use') && preferredMode !== 'AGENTIC') setMode('AGENTIC', { navigate: false });
  }, [preferredMode, setMode, can]);
  return <AgentWorkspace />;
}
