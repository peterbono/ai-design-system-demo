// Team New brand (team shell /studio/<owner>/<repo>/brands/new/, multi-team): what the self-hosted page passes the
// flow at build time (components/ds/studio/NewBrandFlow: token files, bridge.config.json, contrast checks), computed
// from the team's repo model instead. Pure, so it is tested without a browser.
import type { RepoModel } from '@bridge-ds/core';

export type TeamBrandInput =
  | { ok: true; files: Record<string, string>; configText: string; contrastText: string }
  /** What stops a brand: no bridge.config.json (a brand is listed there), or no token files to start from. */
  | { ok: false; reason: 'no-config' | 'no-tokens' };

/**
 * The flow's input from a team's model. The contrast checks are written back as the pairs file the build reads
 * ({ pairs: [[fg, bg, min]] }), so the flow gates on the team's own pairs.
 */
export function teamBrandInput(model: Pick<RepoModel, 'configText' | 'tokens' | 'contrast'>): TeamBrandInput {
  if (!model.configText) return { ok: false, reason: 'no-config' };
  if (!Object.keys(model.tokens.files).length) return { ok: false, reason: 'no-tokens' };
  const contrastText = JSON.stringify({ pairs: model.contrast.specs.map((s) => [s.fg, s.bg, s.min]) });
  return { ok: true, files: model.tokens.files, configText: model.configText, contrastText };
}

/** The draft's storage scope on a team page: one draft per repository. */
export const teamDraftScope = (team: { owner: string; repo: string }): string => `${team.owner}/${team.repo}`.toLowerCase();
