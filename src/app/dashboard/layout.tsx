import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My trips',
  robots: { index: false },
};

export default function TripsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
