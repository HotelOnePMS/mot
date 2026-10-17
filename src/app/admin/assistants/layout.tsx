import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'AI assistants' };

export default function AssistantsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
