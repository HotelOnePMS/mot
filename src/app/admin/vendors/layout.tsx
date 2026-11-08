import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Vendors' };

/** Gives this console page its browser-tab title ("Vendors · HotelOne"); the page itself is a client component. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
