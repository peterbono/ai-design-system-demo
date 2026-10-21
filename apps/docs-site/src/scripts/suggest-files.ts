// Whole-file changes from Studio (a new brand, a revert or a restore) filed as one suggestion, the way the MCP server
// files them (bridge_propose_brand, bridge_propose_revert in suggest mode): each file with the git blob sha it has on
// main (null: new) and its new content, checked against the paths its kind may touch, then createSuggestionOnGitHub.
// Needs Issues write only: no branch, no commit, no pull request.
import {
  createSuggestionOnGitHub,
  gitBlobSha,
  SUGGESTION_SCHEMA,
  suggestionPathProblems,
  type BridgeConfig,
  type GitHubClient,
  type SuggestionKind,
  type SuggestionPayloadV1,
} from '@bridge-ds/core';
import { currentViewer } from './github-session';

export interface FilesSuggestionInput {
  kind: Extract<SuggestionKind, 'brand' | 'revert'>;
  title: string;
  summary: string;
  files: { path: string; content: string | null }[];
  tier: SuggestionPayloadV1['tier'];
  /** The default branch and its head commit, the one the plan was computed on. */
  base: { ref: string; sha: string };
  checks?: Partial<SuggestionPayloadV1['checks']> | undefined;
  /** Labels besides the suggestion ones (tier, tokens, revert...). */
  labels?: string[] | undefined;
  /** The readable details (the pull request body the direct mode would write). */
  details?: string | undefined;
}

/** Files the change as a suggestion. Throws a plain sentence when a path is not one its kind may change. */
export async function suggestFilesOnGitHub(gh: GitHubClient, config: BridgeConfig, input: FilesSuggestionInput): Promise<{ number: number; url: string; warnings: string[] }> {
  const files = await Promise.all(
    input.files.map(async (f) => {
      const now = await gh.getFile(f.path, input.base.sha);
      return { path: f.path, beforeSha: now ? now.sha : null, afterSha: f.content === null ? null : gitBlobSha(f.content), content: f.content };
    }),
  );
  const by = currentViewer()?.login;
  const payload: SuggestionPayloadV1 = {
    schema: SUGGESTION_SCHEMA,
    kind: input.kind,
    title: input.title,
    summary: input.summary.trim() || input.title,
    source: 'studio',
    ...(by ? { suggestedBy: by } : {}),
    createdAt: new Date().toISOString(),
    base: input.base,
    tier: input.tier,
    files,
    checks: { newErrors: 0, contrast: [], blocked: null, impact: 0, ...input.checks },
  };
  const problems = suggestionPathProblems(payload, config);
  if (problems.length) throw new Error(`Not sent: ${problems.join(' ')}`);
  const labels = [...new Set([...(input.labels ?? []), ...(config.integrations?.requests?.labels ?? [])])];
  const created = await createSuggestionOnGitHub(gh, payload, { labels, details: input.details, assignees: config.integrations?.requests?.assignees ?? [] });
  return { number: created.number, url: created.url, warnings: created.warnings };
}
