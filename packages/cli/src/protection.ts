// bridge check: one line on whether the library is protected (every change to the default branch goes through a
// reviewed pull request). Read only, and never part of the exit code: no token, no network or a repo GitHub hides
// all read as "unknown".
import { type FetchLike, GitHubClient, loadProtection, type ProtectionState, protectionSentence, rulesSettingsUrl } from '@bridge-ds/core';

export interface ProtectionReport {
  state: ProtectionState;
  lines: string[];
}

const UNKNOWN: ProtectionState = { kind: 'unknown', missing: ['review', 'checks', 'history', 'deletion'] };

/** The protection line(s) for `repo` ("owner/name"). Never throws. */
export async function protectionReport(opts: { repo: string; defaultBranch: string; token?: string | undefined; fetch?: FetchLike | undefined }): Promise<ProtectionReport> {
  let state = UNKNOWN;
  try {
    const client = new GitHubClient(opts.repo, opts.token ?? '', opts.fetch, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
    state = await loadProtection(client, opts.defaultBranch);
  } catch {
    state = UNKNOWN;
  }
  const [owner, name] = opts.repo.split('/') as [string, string];
  const lines = [`protection: ${protectionSentence(state)}`];
  if (state.kind === 'protected' && state.url) lines.push(`  ${state.url}`);
  if (state.kind === 'unprotected' || state.kind === 'partial') lines.push(`  Protect it in Studio > Settings, or GitHub settings > Rules: ${rulesSettingsUrl(owner, name)}`);
  return { state, lines };
}
