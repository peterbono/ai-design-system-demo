// Who keeps an exploration from now on, for Bridge's own records (api/invites for a lead with GitHub, api/contribute for
// a lead signed in by email).
import { memberRef } from './exploration-member.js';
import { branchKey, issueKey } from './former-member.js';
import { fail, HttpError, json } from './http.js';
import type { MemberStore } from './members.js';
import { repoMetaKey } from './notify.js';
import type { Redis } from './redis.js';

/**
 * The new keeper of an exploration: in the design team's copy, Bridge's own record of who owns its branch goes (the
 * exploration's block says it from now on, api/contribute pullClaimedBy) and notices follow the new owner. An email
 * member must be on the team: the answer gives their reference, the browser never computes one.
 */
export async function explorationKeeper(svc: { redis?: Redis | null | undefined; members?: MemberStore | null | undefined }, team: string, body: Record<string, unknown>): Promise<Response> {
  const redis = svc.redis;
  const copy = typeof body.copy === 'string' ? body.copy.toLowerCase() : null;
  const branch = typeof body.branch === 'string' && body.branch.startsWith('explore/') ? body.branch : null;
  const n = Number(body.number);
  if (!branch || !Number.isSafeInteger(n) || n < 1) return fail(400, 'bad_request', 'Which exploration?');
  let member: { ref: string; name: string; owner: string } | null = null;
  if (typeof body.email === 'string') {
    const m = await svc.members?.get(team, body.email);
    if (!m) throw new HttpError(404, 'not_found', 'They are not on this team.');
    member = { ref: memberRef(m.email), name: m.name, owner: m.email.toLowerCase() };
  }
  if (copy && redis) {
    const meta = await redis.cmd('GET', repoMetaKey(copy));
    if (typeof meta !== 'string' || (JSON.parse(meta) as { team?: string }).team?.toLowerCase() !== team.toLowerCase()) throw new HttpError(403, 'not-allowed', 'That copy is not this team\'s.');
    await redis.pipe([['DEL', branchKey(copy, branch)], member ? ['SET', issueKey(copy, n), member.owner] : typeof body.login === 'string' ? ['SET', issueKey(copy, n), `gh:${body.login.toLowerCase()}`] : ['DEL', issueKey(copy, n)]]);
  }
  return json(200, { ok: true, ...(member ? { ref: member.ref, name: member.name } : {}) });
}
