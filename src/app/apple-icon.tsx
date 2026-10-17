import { ImageResponse } from 'next/og';
import { OgMark } from '@/components/brand/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Home-screen icon: the mark, full bleed (iOS rounds the corners). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex' }}>
        <OgMark size={180} square />
      </div>
    ),
    size
  );
}
