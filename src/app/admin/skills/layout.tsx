import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Skills' };

/** Gives the Skills page its browser-tab title; the page itself is a client component. */
export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
