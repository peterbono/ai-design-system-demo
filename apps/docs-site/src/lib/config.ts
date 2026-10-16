// Which repository this Bridge workspace documents and reviews. Read from bridge.config.json at the repo root, so
// the same site works on any design system repo; the demo repo is only the default.
import { exists, readJson } from './repo';

export interface SiteRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** GitHub logins that count as design and tech owners for Tier 3 approvals. Empty: any two distinct approvers. */
  owners: { design: string[]; tech: string[] };
  /** Token root in the repo, for commits that predate bridge.config.json. */
  tokensRoot: string;
}

const DEFAULT: SiteRepo = { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main', owners: { design: [], tech: [] }, tokensRoot: 'packages/tokens/src' };

interface RawConfig {
  repo?: string | { owner?: string; name?: string; repo?: string; defaultBranch?: string; branch?: string };
  owner?: string;
  defaultBranch?: string;
  governance?: { owners?: { design?: string[]; tech?: string[] } };
  tokens?: { root?: string };
  owners?: { design?: string[]; tech?: string[] };
}

let cache: SiteRepo | null = null;

export function siteRepo(): SiteRepo {
  if (cache) return cache;
  let out = { ...DEFAULT };
  if (exists('bridge.config.json')) {
    const c = readJson<RawConfig>('bridge.config.json');
    if (typeof c.repo === 'string' && c.repo.includes('/')) {
      const [owner, repo] = c.repo.split('/');
      out = { ...out, owner: owner!, repo: repo! };
    } else if (c.repo && typeof c.repo === 'object') {
      out = {
        ...out,
        owner: c.repo.owner ?? out.owner,
        repo: c.repo.name ?? c.repo.repo ?? out.repo,
        defaultBranch: c.repo.defaultBranch ?? c.repo.branch ?? out.defaultBranch,
      };
    }
    if (c.owner) out.owner = c.owner;
    if (c.defaultBranch) out.defaultBranch = c.defaultBranch;
    const owners = c.governance?.owners ?? c.owners;
    if (c.tokens?.root) out.tokensRoot = c.tokens.root;
    if (owners) out.owners = { design: owners.design ?? [], tech: owners.tech ?? [] };
  }
  cache = out;
  return out;
}

/** JSON for client scripts (embedded once per page by the layout). */
export const siteRepoJson = () => JSON.stringify(siteRepo()).replace(/</g, '\\u003c');
