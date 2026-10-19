import type { Metadata } from 'next';
import { TERMS } from '@/config/copy';

export const metadata: Metadata = { title: TERMS.agent };

/** Gives the agent workspace its browser-tab title ("AI agent · HotelOne"); the page itself is a client component. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
