import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'AI advisor' };

/** Gives this console page its browser-tab title ("AI advisor · HotelOne"); the page itself is a client component. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
