import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/config/product';

export const metadata: Metadata = {
  title: 'Contact',
  description: `Questions about switching to ${PRODUCT_NAME}, keeping your current system or the AI phone agent? A person reads every message.`,
  alternates: { canonical: '/contact' },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
