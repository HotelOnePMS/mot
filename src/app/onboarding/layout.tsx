import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@/config/product';

export const metadata: Metadata = {
  title: 'Set up your hotel',
  description: `Create your ${PRODUCT_NAME} account in a few minutes: run your hotel on ${PRODUCT_NAME}, keep your current system, or start with just the voice front desk. Free to start, no card needed.`,
  alternates: { canonical: '/onboarding' },
};

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return children;
}
