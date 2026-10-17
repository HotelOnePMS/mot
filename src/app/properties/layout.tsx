import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/config/product';

export const metadata: Metadata = {
  // The template carries the platform suffix down to child pages that set a
  // plain title (e.g. "Hotel not found · HotelOne"); hotel pages override it
  // with their own name, white-label.
  title: { default: 'Find a stay', template: `%s · ${PRODUCT_NAME}` },
  description: 'Independent hotels, booked direct. Live prices, instant confirmation and free changes until 3 PM the day before you arrive.',
  alternates: { canonical: '/properties' },
};

export default function PropertiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
