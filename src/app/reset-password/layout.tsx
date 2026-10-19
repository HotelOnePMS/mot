import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/config/product';

export const metadata: Metadata = {
  title: 'Choose a new password',
  description: `Choose a new ${PRODUCT_NAME} password.`,
  // The address carries a one-time token: keep it out of search results and Referer headers.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
