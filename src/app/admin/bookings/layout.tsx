import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reservations' };

export default function ReservationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
