import { llmsTxt } from '@/server/agent-api/discovery';
import { publicDocHeaders, requestOrigin } from '@/server/agent-api/http';

/** GET /llms.txt — what HotelOne is and how assistants connect and book (llmstxt.org). */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new Response(llmsTxt(requestOrigin(request)), { headers: publicDocHeaders('text/plain; charset=utf-8') });
}
