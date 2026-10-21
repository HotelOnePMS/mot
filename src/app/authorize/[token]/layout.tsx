import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Authorize a card payment',
  description: 'Authorize a hotel stay paid with your card.',
  // The address carries a one-time token: keep it out of search results and Referer headers.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function AuthorizeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
