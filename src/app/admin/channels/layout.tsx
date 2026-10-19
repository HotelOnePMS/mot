import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Channels' };

/** Gives the channel pages their browser-tab title ("Channels · HotelOne"); the pages themselves are client components. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
