// Decision RT-1: a branch opened from the Figma plugin is labelled waiting-for-claude (the spec only), then
// drafted-by-claude once Claude drafted the code. Drafted reads as ready for review even while GitHub still calls it a
// draft, in Studio, the MCP server and the CLI alike (branchVerdict), and the merge marks it ready first.
import { describe, expect, it } from 'vitest';
import { branchVerdict, claudeStage, isDraft, mergeOnGitHub, pullState, reviewStatusKind, summarizeApprovals, summarizeCi, type GitHubClient } from '../src';

const owners = { design: ['ann'], tech: ['theo'] };
const green = summarizeCi([{ name: 'CI', status: 'completed', conclusion: 'success' }]);
const none = summarizeApprovals([], owners, 'sam');
const both = summarizeApprovals([{ user: { login: 'ann' }, state: 'APPROVED' }, { user: { login: 'theo' }, state: 'APPROVED' }], owners, 'sam');

describe('branches opened from Figma', () => {
  it('reads the stage from the labels, as objects or names', () => {
    expect(claudeStage([{ name: 'waiting-for-claude' }])).toBe('waiting');
    expect(claudeStage(['from-figma', 'drafted-by-claude'])).toBe('drafted');
    expect(claudeStage([{ name: 'tier-2' }])).toBe(null);
    expect(claudeStage(undefined)).toBe(null);
  });

  it('keeps a waiting branch a draft, and reads a drafted one as ready for review', () => {
    expect(pullState({ state: 'open', draft: true, labels: [{ name: 'waiting-for-claude' }] })).toBe('draft');
    expect(pullState({ state: 'open', draft: true, labels: [{ name: 'drafted-by-claude' }] })).toBe('open');
    expect(isDraft({ draft: true, labels: ['drafted-by-claude'] })).toBe(false);
    expect(isDraft({ draft: true })).toBe(true);
    expect(reviewStatusKind({ state: 'open', draft: true, labels: [{ name: 'drafted-by-claude' }], ci: green, approvals: none, tier: 2 })).toBe('needs-design');
  });

  it('gives Studio, the MCP server and the CLI one verdict: a drafted branch is reviewed and merged like any other', () => {
    const base = { tier: 2 as const, ci: green, owners, state: 'open', draft: true, mergeable: true, viewer: 'ann' };
    expect(branchVerdict({ ...base, approvals: none, labels: [{ name: 'waiting-for-claude' }] }).status).toBe('draft');
    expect(branchVerdict({ ...base, approvals: none, labels: [{ name: 'drafted-by-claude' }] }).status).toBe('needs-design');
    const ready = branchVerdict({ ...base, approvals: both, labels: ['drafted-by-claude'] });
    expect(ready.status).toBe('ready');
    expect(ready.gate?.allowed).toBe(true);
  });

  it('marks a GitHub draft ready before merging it: GitHub never merges a draft', async () => {
    const calls: string[] = [];
    const gh = {
      markReadyForReview: async (n: number) => void calls.push(`ready ${n}`),
      mergePullRequest: async (n: number) => (calls.push(`merge ${n}`), { sha: 'abc', merged: true }),
    } as unknown as GitHubClient;
    await mergeOnGitHub(gh, { number: 7, headSha: 'h', draft: true });
    await mergeOnGitHub(gh, { number: 8, headSha: 'h' });
    expect(calls).toEqual(['ready 7', 'merge 7', 'merge 8']);
  });
});
