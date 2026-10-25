// "Fix with Claude": after Check fidelity, the run (each set's verdict per variant, and what the layers read back) goes to
// figma-fidelity.json on the requests branch, where the Bridge MCP server (bridge_figma_gaps, bridge_get_gap_case) and
// the CLI (bridge gaps, bridge fix) read it. The designer's own Claude proposes figma-fixes.json for review; the next
// pull lays the fixes on, and Check fidelity against the story shots decides. Bridge holds no API key.
// The designer sees one button ("Ask Claude to fix it") and one sentence; the commands travel in the text they copy
// for their developer (fixRequestForDeveloper), never on screen.

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

/** What the designer sees once the check is saved: no command, no MCP, no API key (those go to the developer). */
export const FIX_ASKED_TEXT = 'Your developer runs Claude on it. Copy the request and send it to them: it has everything they need.';
/** What happens next, in designer words: the fix comes back through a normal update. */
export const FIX_NEXT_TEXT = 'Once the fix is approved, Check for updates brings it into this file. Then check fidelity again.';

/**
 * "Copy for your developer": the request a designer pastes in Slack or an issue. It holds the ways to run the fix
 * (Claude with the Bridge MCP server, or the CLI with the team's API key), which the plugin never displays. Bridge has
 * no server that runs Claude for the team (yet): a developer starts the run.
 */
export function fixRequestForDeveloper(component: string, repo: string): string {
  return [
    `Could you ask Claude to fix ${component} in Figma? Check fidelity in the Bridge plugin found differences with the code.`,
    '',
    `The check is saved in ${DEFAULT_FIDELITY_RUN_FILE} on the ${REQUESTS_BRANCH} branch${repo ? ` of ${repo}` : ''}.`,
    `- With Claude Code or Claude Desktop and the Bridge MCP server, say: "${fixPhrase(component)}"`,
    `- Or in the repository, with the team's Anthropic API key: ${fixCommand(component)}`,
    '',
    'Claude opens its fixes (figma-fixes.json) for review. Once they are merged, my next pull lays them on.',
  ].join('\n');
}
