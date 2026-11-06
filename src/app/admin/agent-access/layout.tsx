import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Agent access' };

/** Gives the Agent access page its browser-tab title; the page itself is a client component. */
export default function AgentAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
