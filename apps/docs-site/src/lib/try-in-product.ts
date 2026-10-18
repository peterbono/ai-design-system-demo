// "Try it in the product" on a change: the admin demo preview Vercel built for the change, opened with the Bridge
// toolbar (`?bridge=<change>`, apps/admin/src/bridge) on the admin screen that changes most. The URL is only one
// GitHub reported (Vercel commit status, deployment or bot comment), never the config template: Vercel shortens
// long branch aliases, so a template URL can point nowhere.
import { resolveBranchPreviews, type BranchPreviewSources, type PreviewApps } from '@bridge-ds/core';
import type { VisualShot } from './visual-impact';

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

/** The admin screen that changes most in the visual impact, or null when no admin screen changes. */
export function topScreen(shots: readonly VisualShot[] | null | undefined): ProductScreen | null {
  const top = (shots ?? [])
    .filter((s) => s.kind === 'route' && s.route && s.tenant && (s.status === 'changed' || s.status === 'added'))
    .reduce<VisualShot | null>((best, s) => (!best || s.percent > best.percent ? s : best), null);
  return top ? { label: top.label, route: top.route!, tenant: top.tenant!, theme: top.theme } : null;
}

/** The preview with the toolbar on, at that screen (shop and theme in the query, the hash route ra-core reads), else home. */
export function tryInProductUrl(preview: string, pr: number, screen: ProductScreen | null): string {
  const url = new URL(preview);
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
