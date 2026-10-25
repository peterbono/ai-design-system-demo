// Decision TV-1 in Studio (docs/BUILD-REQUESTS.md, "Token values from Studio"): once the design approval is in on a token
// value change, Studio asks Bridge to arm its merge (POST /api/ship, the same server code as a push from Figma). Bridge
// re-reads everything with its own app: the design approval on the head, no changes requested, values only.
//
// When Bridge cannot arm it (auto-merge off on the repository, the app missing, a branch rule), the designer reads the
// calm status the change already has, "Ready to add to the library" with its button; the cause goes to the "For
// developers" fold only. Pure apart from the fetch it is given. Unit tested in values-ship.test.ts.

import { CONTRIBUTE_HEADER } from './contribute';
import { VOCAB } from './vocabulary';

/** What /api/ship answers (api/ship/index.ts ShipResult), as Studio reads it. */
export interface ShipAnswer {
  armed: boolean;
  merged?: boolean;
  code?: string;
  /** Designer words. Studio does not show them: the change's own status says what happens next. */
  reason?: string;
  /** The cause in developer words, for the "For developers" fold. */
  developer?: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Asks Bridge to arm the merge. `bearer`: the viewer's GitHub token (signed in with GitHub); without it, the email
 * member's session cookie of this site. Null when the call itself failed (offline, refused): nothing changes on screen.
 */
export async function askBridgeToShip(repo: string, pr: number, auth: { bearer: string | null }, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<ShipAnswer | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.bearer) headers.Authorization = `Bearer ${auth.bearer}`;
    else headers[CONTRIBUTE_HEADER] = '1';
    const res = await fetchImpl('/api/ship', { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify({ repo, pr }) });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<ShipAnswer> | null;
    if (!body || typeof body.armed !== 'boolean') return null;
    return {
      armed: body.armed,
      ...(body.merged ? { merged: true } : {}),
      ...(typeof body.code === 'string' ? { code: body.code } : {}),
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      ...(typeof body.developer === 'string' ? { developer: body.developer } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Whether Studio asks Bridge to arm a change it shows: a token value change (core branchVerdict approvals.valuesOnly),
 * not a push from Figma (the plugin asks for those), open and not a draft, its design approval in, no changes
 * requested, and not armed yet. Approvals given from the CLI or the MCP server are picked up this way too, the first
 * time someone opens the change in Studio.
 */
export function shouldAskToShip(x: {
  approvals: { valuesOnly?: boolean | undefined; design: boolean; changesRequested: readonly string[] } | null | undefined;
  figmaPush: unknown;
  state: string | undefined;
  draft?: boolean | undefined;
  merged_at?: string | null | undefined;
  autoMerge: boolean;
  exploration?: boolean | undefined;
}): boolean {
  const a = x.approvals;
  if (!a?.valuesOnly || !a.design || a.changesRequested.length) return false;
  return !x.figmaPush && x.state === 'open' && !x.draft && !x.merged_at && !x.autoMerge && !x.exploration;
}

/** The line after Approve on a token value change. Not armed: just "Approved.", the status below says the rest. */
export function approvedSaid(a: ShipAnswer | null): string {
  if (a?.armed && a.merged) return `Approved and ${VOCAB.merged.toLowerCase()}.`;
  if (a?.armed) return `Approved. It is added to ${VOCAB.main} once the automatic checks pass.`;
  return 'Approved.';
}

/** The "For developers" line when Bridge could not arm it, else null. */
export function shipHeldLine(a: ShipAnswer | null | undefined): string | null {
  if (!a || a.armed || !a.developer) return null;
  return `Bridge could not merge this token value change by itself: ${a.developer.replace(/^./, (c) => c.toLowerCase())}`;
}
