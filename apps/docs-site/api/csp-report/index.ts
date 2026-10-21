// POST /api/csp-report: where browsers send Content-Security-Policy-Report-Only violations (vercel.json, report-uri
// and report-to). Each report is logged as one compact line (Vercel function logs) so the policy can be checked
// before it is enforced. Nothing is stored; no cookie or token is read.
// Self-contained on purpose (no imports), so Vercel bundles it as is.

export const MAX_REPORT_BYTES = 16 * 1024;

const FIELDS = ['document-uri', 'documentURL', 'blocked-uri', 'blockedURL', 'violated-directive', 'effective-directive', 'effectiveDirective', 'source-file', 'sourceFile', 'line-number', 'lineNumber', 'disposition', 'sample'] as const;

/** The fields worth logging from one report, strings cut to 300 characters. */
export function summarize(report: unknown): Record<string, string | number> | null {
  if (!report || typeof report !== 'object') return null;
  const out: Record<string, string | number> = {};
  for (const k of FIELDS) {
    const v = (report as Record<string, unknown>)[k];
    if (typeof v === 'string') out[k] = v.slice(0, 300);
    else if (typeof v === 'number') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Reports in either format: { "csp-report": {...} } (report-uri) or [{ type, body }] (Reporting API). */
export function reportsIn(payload: unknown): Record<string, string | number>[] {
  const list = Array.isArray(payload) ? payload.map((r) => (r && typeof r === 'object' ? (r as { body?: unknown }).body : null)) : [(payload as { 'csp-report'?: unknown } | null)?.['csp-report']];
  return list.map(summarize).filter((r): r is Record<string, string | number> => r !== null).slice(0, 20);
}

export async function handleCspReport(req: Request, log: (line: string) => void = console.log): Promise<Response> {
  const done = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return done;
  }
  for (const r of reportsIn(payload)) log(`csp-report ${JSON.stringify(r)}`);
  return done;
}

export function POST(request: Request): Promise<Response> {
  return handleCspReport(request);
}
