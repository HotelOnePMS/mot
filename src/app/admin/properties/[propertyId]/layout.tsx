import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Property details' };

export default function PropertyDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
