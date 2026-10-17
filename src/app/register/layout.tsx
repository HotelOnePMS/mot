import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/config/product';

export const metadata: Metadata = {
  title: 'Create account',
  description: `Create a free ${PRODUCT_NAME} guest account to keep your bookings, receipts and directions in one place.`,
  alternates: { canonical: '/register' },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
