import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reservation' };

export default function ReservationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
