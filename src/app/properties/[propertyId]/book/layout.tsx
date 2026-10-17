import type { Metadata } from 'next';

// The hotel's layout adds " · <hotel name>" to this title.
export const metadata: Metadata = {
  title: 'Confirm and book',
  robots: { index: false },
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
