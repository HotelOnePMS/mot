import { agentUrls } from '@/server/agent-api/discovery';
import { publicDocHeaders, requestOrigin } from '@/server/agent-api/http';
import { API_VERSION } from '@/server/agent-api/openapi';
import { PRODUCT_NAME } from '@/config/product';

/** GET /api/agents/v1 — where the REST API's operations and documents are. */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const origin = requestOrigin(request);
  const u = agentUrls(origin);
  const body = {
    name: `${PRODUCT_NAME} Agent API`,
    version: API_VERSION,
    openapi: u.openapi,
    mcp: u.mcp,
    docs: u.llmsFull,
    operations: {
      searchHotels: `GET ${u.rest}/hotels`,
      getHotel: `GET ${u.rest}/hotels/{propertyId}`,
      checkAvailability: `GET ${u.rest}/hotels/{propertyId}/availability`,
      askHotel: `GET ${u.rest}/hotels/{propertyId}/answers`,
      createBookingLink: `POST ${u.rest}/booking-links`,
      requestBooking: `POST ${u.rest}/booking-requests`,
      createBooking: `POST ${u.rest}/bookings (API key)`,
      findBooking: `GET ${u.rest}/bookings/{code}?lastName=`,
    },
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { ...publicDocHeaders('application/json; charset=utf-8'), 'Cache-Control': 'no-store' } });
}
