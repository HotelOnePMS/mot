import { openApiDocument } from '@/server/agent-api/openapi';
import { publicDocHeaders, publicOrigin } from '@/server/agent-api/http';

/** GET /openapi.json — the REST API's OpenAPI 3.1 description (servers: this deployment’s configured public URL). */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(JSON.stringify(openApiDocument(publicOrigin()), null, 2), { headers: publicDocHeaders('application/json; charset=utf-8') });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: publicDocHeaders('text/plain') });
}
