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

/** The admin preview of a change, or null when GitHub reports none (or the build failed, or it comes from a fork). */
export function productPreview(apps: PreviewApps, ctx: { branch: string; pr: number; sha: string; fromFork?: boolean }, sources: BranchPreviewSources): string | null {
  if (!apps.admin || ctx.fromFork) return null;
  const admin = resolveBranchPreviews(apps, { branch: ctx.branch, pr: ctx.pr, sha: ctx.sha }, sources).find((p) => p.app === 'admin');
  if (!admin?.url || admin.source === 'template' || admin.state === 'failed') return null;
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
