// "Try it in the product" on a branch, shared by Bridge Studio, the MCP server and the CLI: the product preview Vercel
// built for the branch, opened with the Bridge toolbar (`?bridge=<number>`, apps/admin/src/bridge) on a given screen.
// The URL is only one GitHub reported (Vercel commit status, deployment or bot comment), never the config template:
// Vercel shortens long branch aliases, so a template URL can point nowhere.
import { resolveBranchPreviews, type BranchPreviewSources, type PreviewApps } from './previews';

export interface ProductScreen {
  label: string;
  route: string;
  tenant: string;
  theme: string;
}

/**
 * The admin preview of a change, or null when GitHub reports none (or the build failed or was skipped, or it comes
 * from a fork). A skipped build (Vercel's Ignored Build Step) has no deployment: its link opens a canceled page.
 */
export function productPreview(apps: PreviewApps, ctx: { branch: string; pr: number; sha: string; fromFork?: boolean }, sources: BranchPreviewSources): string | null {
  if (!apps.admin || ctx.fromFork) return null;
  const admin = resolveBranchPreviews(apps, { branch: ctx.branch, pr: ctx.pr, sha: ctx.sha }, sources).find((p) => p.app === 'admin');
  if (!admin?.url || admin.source === 'template' || admin.state === 'failed' || admin.skipped) return null;
  return admin.url;
}

/**
 * The preview with the toolbar on, at that screen (shop and theme in the query, the hash route ra-core reads), else home.
 * Only http(s) previews: anything else (a javascript: or data: URL in a hostile comment) gives ''.
 */
export function tryInProductUrl(preview: string, pr: number, screen: ProductScreen | null): string {
  const url = new URL(preview);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  url.pathname = '/';
  url.search = '';
  url.searchParams.set('bridge', String(pr));
  if (screen) {
    url.searchParams.set('tenant', screen.tenant);
    url.searchParams.set('theme', screen.theme);
  }
  url.hash = screen ? screen.route : '';
  return url.href;
}

/**
 * True when nothing reported an online preview of the branch (no Vercel status, deployment or comment, only config
 * templates): explorations and library branches are not deployed, a developer tries them on their machine.
 */
export function noOnlinePreview(previews: readonly { source: string | null }[]): boolean {
  return previews.every((p) => !p.source || p.source === 'template');
}

/** The command that puts a branch on a developer's machine, quoted when the name has shell characters. */
export function localTryCommand(branch: string): string {
  const name = /^[\w./-]+$/.test(branch) ? branch : `'${branch.replace(/'/g, `'\\''`)}'`;
  return `git fetch origin && git switch ${name}`;
}
