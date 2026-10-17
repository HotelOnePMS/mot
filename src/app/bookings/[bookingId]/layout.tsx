import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your booking',
  robots: { index: false },
};

export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
