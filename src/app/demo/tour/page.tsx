import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { OwnerTour } from '@/components/tour/OwnerTour';
import { PRODUCT_NAME } from '@/config/product';
import { TOUR_PATH } from '@/config/tour';

export const metadata: Metadata = {
  title: 'Owner demo',
  description: `A guided tour of the ${PRODUCT_NAME} hotel console, with a sample hotel: dashboard, front desk, reservations, rates, channels, payments, disputes and reports.`,
  alternates: { canonical: TOUR_PATH },
};

/**
 * The owner demo: a sample hotel's console that the voice concierge walks
 * through (or that plays on its own). Static sample data only, never the
 * database, so it shows the same thing to everyone and no real hotel's data.
 */
export default function OwnerTourPage() {
  return (
    <MarketingShell>
      <Suspense>
        <OwnerTour />
      </Suspense>
    </MarketingShell>
  );
}
