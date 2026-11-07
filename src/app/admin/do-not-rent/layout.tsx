import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Do Not Rent' };

/** Gives this console page its browser-tab title ("Do Not Rent · HotelOne"); the page itself is a client component. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
