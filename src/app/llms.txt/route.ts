import { llmsTxt } from '@/server/agent-api/discovery';
import { publicDocHeaders, publicOrigin } from '@/server/agent-api/http';

/** GET /llms.txt — what HotelOne is and how assistants connect and book (llmstxt.org). */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(llmsTxt(publicOrigin()), { headers: publicDocHeaders('text/plain; charset=utf-8') });
}
