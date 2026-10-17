import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Voice front desk' };

export default function VoiceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
