import { llmsFullTxt } from '@/server/agent-api/discovery';
import { publicDocHeaders, requestOrigin } from '@/server/agent-api/http';

/** GET /llms-full.txt — llms.txt plus every tool, argument, endpoint and protocol detail. */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new Response(llmsFullTxt(requestOrigin(request)), { headers: publicDocHeaders('text/plain; charset=utf-8') });
}
