import { NextResponse } from 'next/server';
import { getPaymentConfig } from '@/lib/stripe';
import { isEmailConfigured } from '@/server/email';
import { isBlobConfigured } from '@/lib/cloudinary';
import { voiceProvider } from '@/server/voice/provider';

/** Public capability flags so the frontend can adapt (no secrets exposed). */
export async function GET() {
  return NextResponse.json({
    ...getPaymentConfig(),
    emailEnabled: isEmailConfigured(),
    uploadsEnabled: isBlobConfigured(),
    voiceProvider: voiceProvider(),
  });
}
