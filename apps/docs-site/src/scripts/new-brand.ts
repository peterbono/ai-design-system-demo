// Proposing a new brand from the Studio: re-plan the draft on main as it is now (so the PR applies cleanly),
// refuse when the gate fails, then a new bridge/brand-<slug> branch and a draft Tier 3 pull request. The token
// stays in this browser (scripts/github-session.ts); nothing here runs without it.
import { GitHubClient, composeNewBrandBody, loadRepoFiles, planNewBrand } from '@bridge-ds/core';
import { type BrandDraft, draftInput } from '../lib/new-brand';
import { getToken } from './github-session';

export interface ProposedBrand {
  number: number;
  url: string;
  branch: string;
}

export async function proposeBrand(draft: BrandDraft, repo: { owner: string; name: string; defaultBranch: string }, configTokensRoot: string): Promise<ProposedBrand> {
  const token = getToken();
  if (!token) throw new Error('Connect GitHub to propose this brand.');
  const probe = new GitHubClient(`${repo.owner}/${repo.name}`, token);
  const mainSha = await probe.getBranchSha(repo.defaultBranch);
  if (!mainSha) throw new Error(`Branch ${repo.defaultBranch} was not found in ${repo.owner}/${repo.name}.`);
  const latest = await loadRepoFiles(probe, mainSha, configTokensRoot);
  if (!latest.config) throw new Error('main has no bridge.config.json, so Bridge cannot add a brand to it.');
  const plan = planNewBrand({ config: latest.config, configText: latest.configText, files: latest.files, contrastText: latest.contrastChecks }, draftInput(draft));
  const errors = plan.issues.filter((i) => i.level === 'error');
  if (errors.length) throw new Error(`${errors[0]!.message} Fix it in the draft, then propose again.`);
  if (plan.contrast.failing.length) throw new Error(`${plan.contrast.failing.length} contrast pairs fail on the latest main. Adjust the colors, then propose again.`);
  const gov = latest.config.governance;
  const client = new GitHubClient(`${repo.owner}/${repo.name}`, token, undefined, undefined, { protectedBranches: [...new Set([...gov.protectedBranches, 'main', 'master', repo.defaultBranch])], branchPrefix: gov.branchPrefix });
  let branch = plan.branch;
  for (let i = 2; await client.getBranchSha(branch); i++) branch = `${plan.branch}-${i}`;
  const message = `feat(tokens): add the ${plan.name} brand\n\nStarted from ${plan.from}. Tier 3. Proposed with the Bridge Studio.`;
  await client.commitToNewBranch({ base: repo.defaultBranch, branch, message, files: plan.files.map((f) => ({ path: f.path, content: f.content })) });
  const body = composeNewBrandBody(plan, { tool: 'the Bridge Studio', notes: 'Drafted in the Studio new brand flow, checked with real components in light and dark.' });
  // Tier 3 opens as a draft until design review (docs/GOVERNANCE.md).
  const pr = await client.createPullRequest({ title: `feat(tokens): ${plan.title}`, head: branch, base: repo.defaultBranch, body, draft: true });
  await client.addLabels(pr.number, ['tokens', 'source: bridge-web', 'tier-3', 'new brand']).catch(() => false);
  return { number: pr.number, url: pr.url, branch };
}
