import { llmsFullTxt } from '@/server/agent-api/discovery';
import { publicDocHeaders, publicOrigin } from '@/server/agent-api/http';

/** GET /llms-full.txt — llms.txt plus every tool, argument, endpoint and protocol detail. */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(llmsFullTxt(publicOrigin()), { headers: publicDocHeaders('text/plain; charset=utf-8') });
}
