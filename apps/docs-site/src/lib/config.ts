// Which repository this Bridge workspace documents and reviews. Read from bridge.config.json at the repo root, so
// the same site works on any design system repo; the demo repo is only the default.
import { normalizeRights, type IntegrationsConfig, type Rights, type VisualImpactMode } from '@bridge-ds/core';
import { exists, readJson } from './repo';

export interface SiteRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** GitHub logins that count as design and tech owners for Tier 3 approvals. Empty: any two distinct approvers. */
  owners: { design: string[]; tech: string[] };
  /** Who may merge past missing approvals from Reviews, with a reason. `allowed` empty: no override. */
  override: { allowed: string[]; requireReason: boolean; minReasonLength: number };
  /** Which owner group approves design, approves tech and ships. null: not set, approvals follow owners, anyone with write access ships. */
  rights: Rights | null;
  /** Visual before and after: on every pull request (auto) or when someone asks (on-demand, label visual-check). */
  visualImpact: { mode: VisualImpactMode };
  /** Token root in the repo, for commits that predate bridge.config.json. */
  tokensRoot: string;
  /** Where component change requests go besides the GitHub issue (labels, assignees, Jira). Empty: GitHub only. */
  integrations: IntegrationsConfig;
}

const DEFAULT: SiteRepo = { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main', owners: { design: [], tech: [] }, override: { allowed: [], requireReason: true, minReasonLength: 20 }, rights: null, visualImpact: { mode: 'auto' }, tokensRoot: 'packages/tokens/src', integrations: {} };

interface RawConfig {
  repo?: string | { owner?: string; name?: string; repo?: string; defaultBranch?: string; branch?: string };
  owner?: string;
  defaultBranch?: string;
  governance?: {
    owners?: { design?: string[]; tech?: string[] };
    override?: { allowed?: string[]; requireReason?: boolean; minReasonLength?: number };
    rights?: Partial<Record<keyof Rights, string[]>>;
  };
  visualImpact?: { mode?: string };
  tokens?: { root?: string };
  owners?: { design?: string[]; tech?: string[] };
  integrations?: IntegrationsConfig;
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
    if (c.integrations && typeof c.integrations === 'object') out.integrations = c.integrations;
    const ov = c.governance?.override;
    if (ov)
      out.override = {
        allowed: ov.allowed ?? [],
        requireReason: ov.requireReason ?? true,
        minReasonLength: ov.minReasonLength ?? 20,
      };
    if (c.governance?.rights) out.rights = normalizeRights(c.governance.rights);
    if (c.visualImpact?.mode === 'on-demand') out.visualImpact = { mode: 'on-demand' };
  }
  cache = out;
  return out;
}

/** JSON for client scripts (embedded once per page by the layout). */
export const siteRepoJson = () => JSON.stringify(siteRepo()).replace(/</g, '\\u003c');
