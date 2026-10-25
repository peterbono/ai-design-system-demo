// "Fix with Claude": after Check fidelity, the run (each set's verdict per variant, and what the layers read back) goes to
// figma-fidelity.json on the requests branch, where the Bridge MCP server (bridge_figma_gaps, bridge_get_gap_case) and
// the CLI (bridge gaps, bridge fix) read it. The designer's own Claude proposes figma-fixes.json for review; the next
// pull lays the fixes on, and Check fidelity against the story shots decides. Bridge holds no API key.

import { DEFAULT_FIDELITY_RUN_FILE, type FigmaFidelityRun, type GitHubClient, REQUESTS_BRANCH } from '@bridge-ds/core';
import { ensureRequestsBranch } from './requests';

type RunClient = Pick<GitHubClient, 'owner' | 'name' | 'getBranchSha' | 'createBranch' | 'getFile' | 'putFile'>;

/** Writes (or replaces) figma-fidelity.json on the requests branch. Returns the path written. */
export async function writeFidelityRun(client: RunClient, run: FigmaFidelityRun, baseBranch: string): Promise<string> {
  await ensureRequestsBranch(client as GitHubClient, baseBranch);
  const existing = await client.getFile(DEFAULT_FIDELITY_RUN_FILE, REQUESTS_BRANCH);
  await client.putFile({
    path: DEFAULT_FIDELITY_RUN_FILE,
    content: `${JSON.stringify(run, null, 2)}\n`,
    branch: REQUESTS_BRANCH,
    message: 'Check fidelity from Figma, for Fix with Claude',
    ...(existing ? { sha: existing.sha } : {}),
  });
  return DEFAULT_FIDELITY_RUN_FILE;
}

/** What the designer says to their Claude (Claude Desktop or Claude Code with the Bridge MCP server). */
export const fixPhrase = (component: string) => `Fix ${component} in Figma with Bridge`;

/** The same with the team's Anthropic API key, from the repo. */
export const fixCommand = (component: string) => `npx @bridge-ds/cli fix ${component} --with-claude`;
