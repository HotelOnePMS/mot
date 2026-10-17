import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Rates' };

/** Gives this console page its browser-tab title ("Rates · HotelOne"); the page itself is a client component. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
