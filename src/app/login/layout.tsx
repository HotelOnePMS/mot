import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/config/product';

export const metadata: Metadata = {
  title: 'Sign in',
  description: `Sign in to ${PRODUCT_NAME} to manage your trips or run your hotel.`,
  alternates: { canonical: '/login' },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
