// Has the signed-in viewer connected Bridge in their own Claude? The exploration page asks before "Continue in Claude"
// opens claude.ai (components/ds/studio/ExplorationPage.tsx, the connect dialog). One read of the team's connections
// (api/mcp ?view=connections, the list Settings > Claude shows), kept for the session in this tab. No GitHub read of
// the Studio's own: the server checks who is asking.
//   'yes'      the read found a connection of theirs from Claude: Continue opens Claude directly.
//   'no'       the read succeeded with none: Continue shows the steps first.
//   'unknown'  not asked (signed out, the sample team, a page without a team), still reading, or the read failed:
//              Continue opens Claude directly, as before.
import { connectedInOwnClaude } from '../lib/claude-connector';
import { accessContext } from '../lib/library-access';
import { listConnections } from './connector-api';
import { currentContributor, currentViewer, signedInWithGitHub } from './github-session';
import { repoContext } from './repo-context';

export type ClaudeLink = 'yes' | 'no' | 'unknown';

const KEY = 'bridge:claude-link:';
const reads = new Map<string, Promise<ClaudeLink>>();

/** The team this page works on, and who is asking (a GitHub login or an email member), when the read applies. */
function scope(): { repo: string; key: string } | null {
  if (typeof document === 'undefined') return null;
  const ctx = repoContext();
  const repo = `${ctx.owner}/${ctx.repo}`;
  if (accessContext(repo, document.documentElement.hasAttribute('data-no-repo')) !== 'real') return null;
  const login = signedInWithGitHub() ? currentViewer()?.login : null;
  const member = login ? null : currentContributor();
  if (!login && !member) return null;
  return { repo, key: `${KEY}${repo.toLowerCase()}:${login ? `gh:${login.toLowerCase()}` : `member:${member!.name}`}` };
}

function saved(key: string): ClaudeLink | null {
  try {
    const v = sessionStorage.getItem(key);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
}

function save(key: string, v: ClaudeLink | null) {
  try {
    if (v === 'yes' || v === 'no') sessionStorage.setItem(key, v);
    else sessionStorage.removeItem(key);
  } catch {
    /* private mode: the read runs again next time */
  }
}

/** What this session knows already, with no read: the page paints with it at once. */
export function knownClaudeLink(): ClaudeLink {
  const s = scope();
  return s ? (saved(s.key) ?? 'unknown') : 'unknown';
}

/** Reads it once per session (a failed read is not kept, so a later page asks again). */
export function viewerClaudeLink(): Promise<ClaudeLink> {
  const s = scope();
  if (!s) return Promise.resolve('unknown');
  const have = saved(s.key);
  if (have) return Promise.resolve(have);
  let r = reads.get(s.key);
  if (!r) {
    r = listConnections(s.repo).then(
      (x) => {
        const v: ClaudeLink = connectedInOwnClaude(x.connections) ? 'yes' : 'no';
        save(s.key, v);
        return v;
      },
      () => {
        reads.delete(s.key);
        return 'unknown' as const;
      },
    );
    reads.set(s.key, r);
  }
  return r;
}

/** "I've connected it": forget the answer, so the next page reads it again. */
export function forgetClaudeLink() {
  const s = scope();
  if (!s) return;
  save(s.key, null);
  reads.delete(s.key);
}
