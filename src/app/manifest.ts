import type { MetadataRoute } from 'next';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/config/product';
import { BRAND_HEX } from '@/components/brand/colors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BRAND_HEX.background,
    theme_color: BRAND_HEX.background,
    categories: ['business', 'travel', 'productivity'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
