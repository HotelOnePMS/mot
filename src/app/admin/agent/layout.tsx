import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Agent' };

/** Gives the agent workspace its browser-tab title ("Agent · HotelOne"); the page itself is a client component. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
