import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Your PMS' };

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
