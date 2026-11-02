// The exploration block (core explorations.ts, `<!-- bridge-exploration {...} -->`) of a pull request Bridge writes
// for a member who joined by email: it names them by a stable member reference and their display name, never by their
// email. The proxy (api/contribute) puts it in on every body it writes for them; Studio matches the signed-in member to
// it (home-explorations isOwnExploration). The server copy of the block format: the API does not import core.
import { sha256 } from './http.js';

const MARK = 'bridge-exploration';
const BLOCK = new RegExp(`<!-- ${MARK} (\\{[\\s\\S]*?\\}) -->`);

/** A member's stable reference: 16 hex characters of a hash of their email, the same everywhere, never the email. */
export const memberRef = (email: string): string => sha256(`member:${email.trim().toLowerCase()}`).slice(0, 16);

const isEmail = (v: unknown) => typeof v === 'string' && v.includes('@');

/** The exploration block of a pull request body as an object, or null (no block, or not one Bridge can read). */
export function explorationBlockOf(body: unknown): Record<string, unknown> | null {
  const m = typeof body === 'string' ? BLOCK.exec(body) : null;
  if (!m) return null;
  try {
    const e = JSON.parse(m[1]!) as unknown;
    return e && typeof e === 'object' && !Array.isArray(e) ? (e as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The body with the member named in its exploration block: `member` and `memberName` for who started it (kept once
 * set), `doneByMember` once it says Done exploring with no GitHub login for it; any email in `author`, `doneBy` or
 * `reopenedBy` is dropped. A body without a block comes back as it is. With `owner`, `member` and `memberName` are
 * that member whatever the body says: the proxy names who started the exploration, the browser never does.
 */
export function withMemberInBlock(body: string, who: { ref: string; name: string }, owner?: { ref: string; name: string }): string {
  const m = BLOCK.exec(body);
  if (!m) return body;
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(m[1]!) as Record<string, unknown>;
  } catch {
    return body;
  }
  if (!e || typeof e !== 'object' || typeof e.name !== 'string') return body;
  for (const k of ['author', 'doneBy', 'reopenedBy']) if (isEmail(e[k])) delete e[k];
  if (owner) {
    e.member = owner.ref;
    e.memberName = owner.name.trim().slice(0, 80);
  } else if (typeof e.member !== 'string') {
    e.member = who.ref;
    e.memberName = who.name.trim().slice(0, 80);
  }
  if (typeof e.doneAt === 'string' && typeof e.doneBy !== 'string' && typeof e.doneByMember !== 'string') e.doneByMember = who.ref;
  if (typeof e.doneAt !== 'string') delete e.doneByMember;
  const block = `<!-- ${MARK} ${JSON.stringify(e).replace(/-->/g, '--\\u003e')} -->`;
  return body.slice(0, m.index) + block + body.slice(m.index + m[0].length);
}
