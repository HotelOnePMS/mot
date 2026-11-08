import { renderEvidenceHtml, renderEvidenceText, type EvidenceSummary } from './evidence';

/** Dispute evidence as a download: a text file, or a page to print or save as a PDF (shown in the browser). */
export function evidenceResponse(summary: EvidenceSummary | null, opts: { code: string; format: 'txt' | 'html' }): Response {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (!summary) {
    return new Response('No evidence could be assembled for this dispute.', { headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (opts.format === 'html') {
    // Everything on the page is escaped; the policy also rules out scripts, should anything slip through.
    const csp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
    return new Response(renderEvidenceHtml(summary, `Chargeback response · ${opts.code}`), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp } });
  }
  return new Response(renderEvidenceText(summary), {
    headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="dispute-evidence-${opts.code.replace(/[^A-Za-z0-9_-]/g, '')}.txt"` },
  });
}
