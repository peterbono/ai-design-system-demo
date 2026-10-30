// What the self-hosted Studio embeds at build time about its repository, computed from a team's repo model in the
// browser instead (multi-team): the contrast failures the build gate counts, and the guidance drafts waiting for
// review. Shared by team Home (scripts/team-home.ts) and team Review (scripts/team-review.ts). Pure.
import type { RepoModel } from '@bridge-ds/core';
import { libraryHref } from './library-shells';

/** Failing contrast checks of a model: one per pair, brand and theme, as the build gate counts them. */
export function contrastFailures(model: Pick<RepoModel, 'contrast'>): number {
  let fail = 0;
  for (const p of model.contrast.pairs) {
    const brands = Object.values(p.brands);
    const results = brands.length ? brands.flatMap((b) => Object.values(b)) : Object.values(p.modes);
    fail += results.filter((r) => r.ratio < p.min).length;
  }
  return fail;
}

/** Drafted guidance waiting for review: each row opens the draft on GitHub (the docs editor is the demo Library's). */
export function teamGuidance(data: { owner: string; repo: string; sha: string; model: Pick<RepoModel, 'components'> }): { name: string; slug: string; href: string; since: string | null }[] {
  return (data.model.components?.list ?? [])
    .filter((c) => c.docs?.needsReview)
    .map((c) => ({ name: c.name, slug: c.slug, href: `${libraryHref(data.owner, data.repo, `components/${encodeURIComponent(c.slug.toLowerCase())}/`)}?edit=1`, since: null }));
}
