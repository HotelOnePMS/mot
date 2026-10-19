import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/config/product';

export const metadata: Metadata = {
  title: 'Forgot password',
  description: `Get a link to choose a new ${PRODUCT_NAME} password.`,
  alternates: { canonical: '/forgot-password' },
  robots: { index: false },
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
