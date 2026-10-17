import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Analytics' };

/** Gives this console page its browser-tab title ("Analytics · HotelOne"); the page itself is a client component. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
