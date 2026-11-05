// Approving Claude's fixes from the plugin (POST /api/ship, actions "can-approve-fixes" and "approve-fixes" of the
// Bridge site, api/_lib/fixes-approve.ts). Bridge decides who approves (the team's leads and admins) and checks every
// fix again with its own GitHub App before anything lands; asking never widens anything. Readers and contributors never
// see the button: their ready rows say "Waiting for approval".

import { STUDIO_ORIGIN } from '../shared/messages';

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const APPROVE_FIX_WORDS = {
  all: (n: number) => `Approve all ${n}`,
  one: 'Approve',
  approving: 'Approving',
  /** A lead's ready row: what Approve does. */
  leadHint: 'Approve it to bring it into this file.',
  /** Everyone else's ready row. */
  waiting: 'Waiting for approval. Once a lead approves it, Check for updates brings it into this file.',
  approved: (n: number) => (n === 1 ? 'Approved. Checking for updates.' : `${n} fixes approved. Checking for updates.`),
  armed: (n: number) => `${n === 1 ? 'Approved' : `${n} fixes approved`}. They come in once the automatic checks pass: then Check for updates.`,
  someRefused: (n: number) => `${n === 1 ? 'One fix was' : `${n} fixes were`} not approved: the row says why.`,
  unreachable: 'Bridge could not be reached. Check your connection, then approve again.',
} as const;

const post = async (f: Fetch, origin: string, token: string, body: unknown) => {
  const res = await f(`${origin}/api/ship`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

/** Whether this sign-in approves Claude's fixes on this team. False whenever Bridge cannot say (the row then waits). */
export async function canApproveFixes(f: Fetch, token: string, repo: string, origin = STUDIO_ORIGIN): Promise<boolean> {
  try {
    const r = await post(f, origin, token, { repo, action: 'can-approve-fixes' });
    return r.ok && r.data.canApprove === true;
  } catch {
    return false;
  }
}

export interface ApproveAnswer {
  approved: number[];
  refused: { pr: number; reason: string }[];
  /** On the library now: Check for updates brings them in. */
  landed: boolean;
}

/** Approves these fixes (pull request numbers, with the head each had when shown). Throws a designer sentence. */
export async function approveFixes(f: Fetch, token: string, repo: string, prs: readonly number[], heads: Record<number, string> = {}, origin = STUDIO_ORIGIN): Promise<ApproveAnswer> {
  let r: Awaited<ReturnType<typeof post>>;
  try {
    r = await post(f, origin, token, { repo, action: 'approve-fixes', prs, ...(Object.keys(heads).length ? { heads } : {}) });
  } catch {
    throw new Error(APPROVE_FIX_WORDS.unreachable);
  }
  const d = r.data;
  if (!r.ok || d.error) throw new Error(typeof d.message === 'string' && d.message ? d.message : `Bridge could not approve them (${r.status}).`);
  const approved = Array.isArray(d.approved) ? d.approved.flatMap((x) => (typeof (x as { pr?: unknown })?.pr === 'number' ? [(x as { pr: number }).pr] : [])) : [];
  const refused = Array.isArray(d.refused)
    ? d.refused.flatMap((x) => {
        const o = x as { pr?: unknown; reason?: unknown };
        return typeof o?.pr === 'number' && typeof o.reason === 'string' ? [{ pr: o.pr, reason: o.reason }] : [];
      })
    : [];
  return { approved, refused, landed: d.landed === true };
}
