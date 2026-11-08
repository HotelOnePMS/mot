import { NextRequest } from 'next/server';
import { publicSiteUrl } from '@/server/public-url';

/**
 * GET /api/channels/google/point-of-sale — the Point of Sale file to upload in
 * Google Hotel Center so free booking links open the hotel's HotelOne booking page.
 * Google fills in the (VARIABLES) for each link.
 */
export async function GET(request: NextRequest) {
  const base = publicSiteUrl() ?? request.nextUrl.origin;
  const landing =
    `${base}/api/channels/google/landing?hotel=(PARTNER-HOTEL-ID)` +
    '&amp;checkin=(CHECKINYEAR)-(CHECKINMONTH)-(CHECKINDAY)&amp;nights=(LENGTH)&amp;adults=(NUM-ADULTS)';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PointsOfSale>
  <PointOfSale id="hotelone-direct">
    <URL>${landing}</URL>
  </PointOfSale>
</PointsOfSale>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
