// Which repository this Bridge workspace documents and reviews. Read from bridge.config.json at the repo root, so
// the same site works on any design system repo; the demo repo is only the default.
import { DEFAULT_CHANGES_MODE, DEFAULT_PRODUCTS, normalizeRights, productProblems, type ChangesMode, type IntegrationsConfig, type ProductConfig, type Rights, type VisualImpactMode } from '@bridge-ds/core';
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
  /** governance.soloOwnerCanApproveBoth: the only owner's approval covers design and tech. Default false. */
  soloOwnerCanApproveBoth: boolean;
  /** Visual before and after: on every pull request (auto) or when someone asks (on-demand, label visual-check). */
  visualImpact: { mode: VisualImpactMode };
  /** Token root in the repo, for commits that predate bridge.config.json. */
  tokensRoot: string;
  /** Where component change requests go besides the GitHub issue (labels, assignees, Jira). Empty: GitHub only. */
  integrations: IntegrationsConfig;
  /** The apps that consume the design system (bridge.config.json products), the library being the default. */
  products: ProductConfig[];
  /**
   * How changes reach the code (bridge.config.json "changes"): "suggest" (the default) files a suggestion for a
   * developer to apply, "direct" opens branches and pull requests. Until the read-only GitHub App ships, suggest mode
   * is a Bridge rule: Studio never writes a branch or a pull request in it.
   */
  changes: ChangesMode;
}

const DEFAULT: SiteRepo = { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main', owners: { design: [], tech: [] }, override: { allowed: [], requireReason: true, minReasonLength: 20 }, rights: null, soloOwnerCanApproveBoth: false, visualImpact: { mode: 'auto' }, tokensRoot: 'packages/tokens/src', integrations: {}, products: DEFAULT_PRODUCTS, changes: DEFAULT_CHANGES_MODE };

interface RawConfig {
  repo?: string | { owner?: string; name?: string; repo?: string; defaultBranch?: string; branch?: string };
  owner?: string;
  defaultBranch?: string;
  governance?: {
    owners?: { design?: string[]; tech?: string[] };
    override?: { allowed?: string[]; requireReason?: boolean; minReasonLength?: number };
    rights?: Partial<Record<keyof Rights, string[]>>;
    soloOwnerCanApproveBoth?: boolean;
  };
  visualImpact?: { mode?: string };
  tokens?: { root?: string };
  owners?: { design?: string[]; tech?: string[] };
  integrations?: IntegrationsConfig;
  products?: unknown;
  changes?: unknown;
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
    out.soloOwnerCanApproveBoth = c.governance?.soloOwnerCanApproveBoth === true;
    if (c.visualImpact?.mode === 'on-demand') out.visualImpact = { mode: 'on-demand' };
    out.changes = c.changes === 'direct' ? 'direct' : DEFAULT_CHANGES_MODE;
    if (Array.isArray(c.products) && c.products.length && !productProblems(c.products).length) out.products = c.products as ProductConfig[];
  }
  cache = out;
  return out;
}

/** JSON for client scripts (embedded once per page by the layout). */
export const siteRepoJson = () => JSON.stringify(siteRepo()).replace(/</g, '\\u003c');
