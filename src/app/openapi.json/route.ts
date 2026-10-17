import { openApiDocument } from '@/server/agent-api/openapi';
import { publicDocHeaders, requestOrigin } from '@/server/agent-api/http';

/** GET /openapi.json — the REST API's OpenAPI 3.1 description (servers: the origin you reached us on). */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new Response(JSON.stringify(openApiDocument(requestOrigin(request)), null, 2), { headers: publicDocHeaders('application/json; charset=utf-8') });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: publicDocHeaders('text/plain') });
}
