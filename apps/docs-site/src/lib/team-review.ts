// Team Review (team shell /studio/<owner>/<repo>/review/, multi-team): the data blocks the self-hosted review queue
// (pages/studio/review.astro) embeds at build time, from the team's repo model. scripts/team-review.ts writes them
// into the page as JSON text before the queue (scripts/review-queue-page.ts) starts. Pure.
import type { RepoModel } from '@bridge-ds/core';
import type { BranchesConfig } from './branches';
import { contrastFailures, teamGuidance } from './team-facts';

export interface TeamReviewInput {
  owner: string;
  repo: string;
  sha: string;
  defaultBranch: string;
  model: Pick<RepoModel, 'contrast' | 'components'>;
}

/** The blocks, as [element id, JSON value], in the order the self-hosted page writes them. */
export function teamReviewBlocks(data: TeamReviewInput): [string, unknown][] {
  // A team has no preview apps of its own yet: the branch review shows the token diff and checks without them.
  const branches: BranchesConfig = { owner: data.owner, repo: data.repo, defaultBranch: data.defaultBranch, apps: {}, packages: [] };
  return [
    ['home-static', { contrastFail: contrastFailures(data.model) }],
    ['home-guidance', { drafted: teamGuidance(data) }],
    // The team's own contrast pairs, in the checks file format the token review falls back to.
    ['bridge-contrast', { pairs: data.model.contrast.specs.map((s) => [s.fg, s.bg, s.min]) }],
    ['bridge-branches', branches],
  ];
}
