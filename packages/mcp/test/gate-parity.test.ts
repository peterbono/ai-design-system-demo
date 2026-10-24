// One verdict everywhere (docs/GOVERNANCE.md, "One verdict everywhere"): the same fixture pull requests, on one
// in-memory GitHub, read by Studio (apps/docs-site lib/review-rules studioVerdict, fed the way the branch page and the
// status chips read GitHub), by the MCP tools (bridge_branch_status, bridge_merge_branch) and by the CLI
// (`bridge branch status|merge`), must give the same status, the same merge verdict, the same reasons and the same
// owner override answer. The rules covered: Tier 1 needs one owner approval (RV-11), the override is for owners only
// (RV-08) and always needs a reason, 20 characters by default (RV-18), and the pull request that applies an approved
// suggestion with "Closes #n" carries its approvals while it stays approved and the tier is not higher (RV-14).
// Nothing leaves the process: the GitHub is a fake, the CLI's token is a fake passed in its own env, never gh.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { approvedSuggestionNumber, closingIssueNumbers, lookAgainReviewers, figmaPushOf, GitHubClient, tokenFileChanges, parseModelConfig, shipPolicy, siteRepoFromConfig, summarizeCi, type ReviewLike, type SuggestionGovernance } from '@bridge-ds/core';
import { BridgeContext, branches, ops, studio, suggestions } from '../src/lib.js';
import { runBranch } from '../../cli/src/branch.js';
import type { RequestIO } from '../../cli/src/request.js';
import { studioVerdict } from '../../../apps/docs-site/src/lib/review-rules.js';
import { effectiveTier } from '../../../apps/docs-site/src/lib/review-queue.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

const OWNER = 'peterbono';
const NAME = 'ai-design-system-demo';
const FULL = `${OWNER}/${NAME}`;

/**
 * This repo's config with two owners (ann designs, theo codes), lea named in the override list but owner of nothing,
 * both groups allowed to ship, and an override policy that asks for no reason (the reason stays required anyway).
 * Suggest mode, so the suggestions below are issues.
 */
function parityConfig(text: string): string {
  const cfg = JSON.parse(text);
  delete cfg.changes;
  cfg.governance.owners = { design: ['ann'], tech: ['theo'] };
  cfg.governance.rights = { approveDesign: ['design'], approveTech: ['tech'], ship: ['design', 'tech'] };
  delete cfg.governance.soloOwnerCanApproveBoth;
  cfg.governance.override = { allowed: ['ann', 'lea'], requireReason: false, minReasonLength: 0 };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

type Gh = ReturnType<typeof fakeGitHub>;

/** A branch with `files` changed from main and its open pull request, as GitHub returns it. */
function openPull(gh: Gh, x: { title: string; files: Record<string, string>; labels?: string[]; body?: string; draft?: boolean }): number {
  const main = gh.refs.get('main')!;
  const files = new Map(gh.commits.get(main)!.files);
  for (const [p, t] of Object.entries(x.files)) files.set(p, t);
  const sha = gh.id();
  gh.commits.set(sha, { files, parents: [main] });
  const number = gh.pulls.length + 1;
  const ref = `bridge/fixture-${number}`;
  gh.refs.set(ref, sha);
  gh.pulls.push({ number, node_id: `PR_node_${number}`, title: x.title, body: x.body ?? '', state: 'open', draft: x.draft ?? false, user: { login: 'agent' }, head: { ref, sha }, base: { ref: 'main' }, labels: (x.labels ?? []).map((name) => ({ name })), html_url: `https://github.com/${FULL}/pull/${number}`, updated_at: '2026-10-16T00:00:00Z' });
  return number;
}

const review = (gh: Gh, n: number, login: string, state: 'APPROVED' | 'CHANGES_REQUESTED') => {
  const list = gh.reviews.get(n) ?? [];
  gh.reviews.set(n, [...list, { id: 800 + list.length, user: { login }, state, submitted_at: `2026-10-17T00:00:0${list.length}Z`, commit_id: gh.pulls[n - 1]!.head.sha }]);
};

const DOC = (s: string) => ({ 'docs/parity-notes.md': `# Notes\n\n${s}\n` });
const DARKEN = { title: 'Darken muted text', summary: 'Muted text is too light.', edits: [{ op: 'set' as const, path: 'color.text.muted', value: '{palette.neutral.700}', mode: { theme: 'light' } }] };

let gh: Gh;
let dir: string;
const config = () => parityConfig(readFileSync(join(REPO, 'bridge.config.json'), 'utf8'));
const pr: Record<string, number> = {};
const issue: Record<string, number> = {};

async function as(login: string | null) {
  if (login) gh.viewer.login = login;
  return BridgeContext.create({ repo: FULL, ...(login ? { token: 'fake' } : {}), fetch: gh.fetch });
}

beforeAll(async () => {
  const files = readTree(REPO, REAL_PATHS);
  files['bridge.config.json'] = config();
  gh = fakeGitHub(OWNER, NAME, files);
  dir = tempGitRepo(REPO, REAL_PATHS);
  writeFileSync(join(dir, 'bridge.config.json'), config());

  // Suggestions, filed by the agent and reviewed on the issue by the owners.
  const author = await as('agent');
  issue.tier3Approved = ((await ops.proposeTokenChange(author, DARKEN)) as any).number;
  issue.tier3Half = ((await ops.proposeTokenChange(author, { ...DARKEN, title: 'Darken muted text more', edits: [{ ...DARKEN.edits[0]!, value: '{palette.neutral.800}' }] })) as any).number;
  issue.tier1Approved = ((await studio.saveDocs(author, { component: 'Button', docs: { summary: 'Starts an action in one click.' } })) as any).number;
  for (const [n, who] of [
    [issue.tier3Approved, 'ann'],
    [issue.tier3Approved, 'theo'],
    [issue.tier3Half, 'ann'],
    [issue.tier1Approved, 'ann'],
  ] as const) {
    await suggestions.reviewSuggestionOp(await as(who), { number: n!, event: 'approve' });
  }

  // Tier 1: approved by someone who is no owner, then by an owner.
  pr.t1NotOwner = openPull(gh, { title: 'Docs: a typo', files: DOC('a') });
  review(gh, pr.t1NotOwner, 'lea', 'APPROVED');
  pr.t1Owner = openPull(gh, { title: 'Docs: another typo', files: DOC('b') });
  review(gh, pr.t1Owner, 'theo', 'APPROVED');
  // Tier 3 with nothing approved: only the override could merge it, and only for an owner.
  pr.t3None = openPull(gh, { title: 'Tokens: no review yet', files: DOC('c'), labels: ['tier-3'] });
  // The pull requests that apply suggestions ("Closes #n").
  pr.applyApproved = openPull(gh, { title: 'Apply the approved suggestion', files: DOC('d'), labels: ['tier-3'], body: `Applies it.\n\nCloses #${issue.tier3Approved}` });
  pr.applyHalf = openPull(gh, { title: 'Apply a half approved suggestion', files: DOC('e'), labels: ['tier-3'], body: `Closes #${issue.tier3Half}` });
  pr.applyTierUp = openPull(gh, { title: 'Apply a Tier 1 suggestion as Tier 2', files: DOC('f'), labels: ['tier-2'], body: `Closes #${issue.tier1Approved}` });
  pr.applyTier1 = openPull(gh, { title: 'Apply a Tier 1 suggestion', files: DOC('g'), body: `Closes #${issue.tier1Approved}` });
  pr.applyAsked = openPull(gh, { title: 'Apply, with changes asked on the branch', files: DOC('h'), labels: ['tier-3'], body: `Closes #${issue.tier3Approved}` });
  review(gh, pr.applyAsked, 'theo', 'CHANGES_REQUESTED');
  // Decision RT-1: branches opened from Figma, still GitHub drafts. The spec only (waiting-for-claude) stays a draft;
  // once Claude drafted the code (drafted-by-claude) it is reviewed and merged like any branch in review.
  pr.figmaWaiting = openPull(gh, { title: 'Button: add a lg size', files: DOC('i'), labels: ['from-figma', 'waiting-for-claude'], draft: true });
  pr.figmaDrafted = openPull(gh, { title: 'Button: add a xl size', files: DOC('j'), labels: ['from-figma', 'drafted-by-claude'], draft: true });
  review(gh, pr.figmaDrafted, 'theo', 'APPROVED');
  // docs/BUILD-REQUESTS.md: a push from the Figma plugin is design-approved. Token values only: tech-approved too, it
  // ships by itself. A token renamed or removed: the tech approval is still needed.
  const radius = JSON.parse(files[RADIUS]!);
  const [group, first] = firstToken(radius);
  const values = structuredClone(radius);
  values[group][first].$value = bumped(values[group][first].$value);
  pr.figmaValues = openPull(gh, { title: 'Tokens: rounder radius', files: { [RADIUS]: `${JSON.stringify(values, null, 2)}\n` }, labels: ['tier-3', 'tokens', 'source: figma', 'from-figma'] });
  const renamed = structuredClone(radius);
  renamed[group][`${first}-renamed`] = renamed[group][first];
  delete renamed[group][first];
  // Merged without the approvals it once waited for (an override, or rules changed since): done, nothing missing.
  pr.mergedNone = openPull(gh, { title: 'Tokens: merged long ago', files: DOC('k'), labels: ['tier-3'] });
  Object.assign(gh.pulls[pr.mergedNone - 1]!, { state: 'closed', merged: true, merged_at: '2026-10-20T00:00:00Z' });
  // Changes requested by ann, then the author pushed a new commit: ann looks again (core lookAgainReviewers).
  pr.updatedAfter = openPull(gh, { title: 'Docs: updated after changes', files: DOC('l') });
  review(gh, pr.updatedAfter, 'ann', 'CHANGES_REQUESTED');
  {
    const p = gh.pulls[pr.updatedAfter - 1]!;
    const files2 = new Map(gh.commits.get(p.head.sha)!.files);
    files2.set('docs/parity-notes.md', '# Notes\n\nl, fixed\n');
    const sha2 = gh.id();
    gh.commits.set(sha2, { files: files2, parents: [p.head.sha] });
    gh.refs.set(p.head.ref, sha2);
    p.head.sha = sha2;
  }
  pr.figmaRename = openPull(gh, { title: 'Tokens: rename a radius', files: { [RADIUS]: `${JSON.stringify(renamed, null, 2)}\n` }, labels: ['tier-3', 'tokens', 'breaking', 'source: figma'] });
}, 60000);

const RADIUS = 'packages/tokens/src/primitives/radius.tokens.json';

/** The first token of a token file: its group and name (a node with $value two levels down). */
function firstToken(doc: Record<string, any>): [string, string] {
  for (const [g, v] of Object.entries(doc)) {
    if (g.startsWith('$') || !v || typeof v !== 'object') continue;
    for (const [k, t] of Object.entries(v as Record<string, any>)) if (t && typeof t === 'object' && '$value' in t) return [g, k];
  }
  throw new Error(`No token two levels down in ${RADIUS}`);
}

/** Another value of the same shape: a dimension one more, anything else a changed string. */
const bumped = (v: any) => (v && typeof v === 'object' && typeof v.value === 'number' ? { ...v, value: v.value + 1 } : typeof v === 'number' ? v + 1 : `${String(v)}-x`);

/** What Studio reads for one pull request (scripts/pr-status.ts and scripts/reviews.ts), then its verdict. */
async function studioReads(n: number, viewer: string | null) {
  const get = async <T>(path: string): Promise<T> => (await (await gh.fetch(`https://api.github.com/repos/${FULL}${path}`)).json()) as T;
  const pull = await get<any>(`/pulls/${n}`);
  const [reviews, files, runs, status] = await Promise.all([
    get<ReviewLike[]>(`/pulls/${n}/reviews?per_page=100`),
    get<{ filename: string; status: string }[]>(`/pulls/${n}/files?per_page=100`),
    get<{ check_runs: any[] }>(`/commits/${pull.head.sha}/check-runs?per_page=100`),
    get<{ statuses: any[] }>(`/commits/${pull.head.sha}/status`),
  ]);
  // The repository settings as the site embeds them (core siteRepoFromConfig), no team to expand.
  const parsed = parseModelConfig(config());
  const site = siteRepoFromConfig(parsed.config, parsed.raw);
  const gov: SuggestionGovernance = { owners: site.owners, rights: site.rights, soloOwnerCanApproveBoth: site.soloOwnerCanApproveBoth };
  const client = new GitHubClient(FULL, '', gh.fetch);
  let suggestion = null;
  for (const k of closingIssueNumbers(pull.body).slice(0, 3)) {
    suggestion = await approvedSuggestionNumber(client, k, gov).catch(() => null);
    if (suggestion) break;
  }
  const tier = effectiveTier(pull.labels, pull.body, files);
  const ci = summarizeCi(runs.check_runs, status.statuses);
  // A push from the Figma plugin, read the way Studio's branch page reads it: the token files at main and at the head.
  const raw = async (p: string, ref: string) => {
    const r = await gh.fetch(`https://api.github.com/repos/${FULL}/contents/${encodeURIComponent(p)}?ref=${ref}`, { headers: { accept: 'application/vnd.github.raw' } });
    return r.ok ? r.text() : null;
  };
  const tokenFiles = files.filter((f) => f.filename.endsWith('.tokens.json'));
  const tokenChanges = tokenFileChanges(await Promise.all(tokenFiles.map(async (f) => ({ before: f.status === 'added' ? null : await raw(f.filename, 'main'), after: f.status === 'removed' ? null : await raw(f.filename, pull.head.sha) }))));
  const figmaPush = figmaPushOf({ labels: pull.labels, body: pull.body }, { files: files.map((f) => ({ path: f.filename, status: f.status })), tokenChanges, config: parsed.config });
  return studioVerdict({ site, pull, tier, ci, reviews, suggestion, mergeable: pull.mergeable, viewer, ship: shipPolicy(site.owners, site.rights), figmaPush });
}

function cliIO(viewer: string | null) {
  const out: string[] = [];
  const err: string[] = [];
  // The token lives in this fake env only: never GITHUB_TOKEN from the process, never the gh sign-in.
  const io: RequestIO = { print: (s) => out.push(s), error: (s) => err.push(s), env: viewer ? { GITHUB_TOKEN: 'fake' } : {}, fetch: gh.fetch, ghToken: () => undefined, hasClaude: () => false, runClaude: () => 0 };
  return { io, out: () => out.join('\n'), err: () => err.join('\n') };
}

const argv = (...xs: string[]) => {
  const a = { _: [] as string[], flags: {} as Record<string, string[]> };
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    if (x.startsWith('--')) {
      const k = x.slice(2);
      const next = xs[i + 1];
      (a.flags[k] ??= []).push(next !== undefined && !next.startsWith('--') && !['json', 'dry-run'].includes(k) ? xs[++i]! : 'true');
    } else a._.push(x);
  }
  return a;
};

async function cliStatus(n: number, viewer: string | null) {
  if (viewer) gh.viewer.login = viewer;
  const c = cliIO(viewer);
  expect(await runBranch(argv('branch', 'status', String(n), '--json'), dir, c.io)).toBe(0);
  return JSON.parse(c.out());
}

const VIEWERS = [null, 'ann', 'theo', 'lea'] as const;

/** The verdict each surface gives, side by side: Studio, the MCP tool, the CLI. */
async function verdicts(n: number, viewer: string | null) {
  const s = await studioReads(n, viewer);
  const m = (await branches.branchStatus(await as(viewer), { pr: n })) as any;
  const c = await cliStatus(n, viewer);
  const studioSide = { status: s.status, allowed: s.gate!.allowed, reasons: s.gate!.reasons, ...(viewer ? { override: s.gate!.overridable } : {}) };
  const view = (r: any) => ({ status: r.status.kind, allowed: r.merge.allowed, reasons: r.merge.blockedBy, ...(viewer ? { override: r.merge.ownerOverride } : {}) });
  return { studio: studioSide, mcp: view(m), cli: view(c) };
}

describe('the same fixture pull requests give the same verdict in Studio, the MCP server and the CLI', () => {
  const EXPECTED: [string, { status: string; allowed: boolean; reason?: RegExp }][] = [
    ['t1NotOwner', { status: 'needs-approval', allowed: false, reason: /It needs one owner approval\./ }],
    ['t1Owner', { status: 'ready', allowed: true }],
    ['t3None', { status: 'needs-design', allowed: false, reason: /design owner approval/ }],
    ['applyApproved', { status: 'ready', allowed: true }],
    ['applyHalf', { status: 'needs-design', allowed: false }],
    ['applyTierUp', { status: 'needs-design', allowed: false }],
    ['applyTier1', { status: 'ready', allowed: true }],
    ['applyAsked', { status: 'changes-requested', allowed: false, reason: /changes/i }],
    ['figmaWaiting', { status: 'draft', allowed: false, reason: /draft/i }],
    ['figmaDrafted', { status: 'ready', allowed: true }],
    ['mergedNone', { status: 'merged', allowed: false, reason: /^This branch is already merged\.$/ }],
  ];

  for (const [name, want] of EXPECTED) {
    it(`${name}: ${want.status}, ${want.allowed ? 'mergeable' : 'blocked'}, for every viewer`, async () => {
      for (const viewer of VIEWERS) {
        const v = await verdicts(pr[name]!, viewer);
        expect(v.mcp, `MCP vs Studio, viewer ${viewer}`).toEqual(v.studio);
        expect(v.cli, `CLI vs Studio, viewer ${viewer}`).toEqual(v.studio);
        expect(v.studio.status).toBe(want.status);
        // lea owns nothing, so she does not hold the right to ship: ready, but not hers to merge.
        expect(v.studio.allowed).toBe(want.allowed && viewer !== 'lea');
        if (want.allowed && viewer === 'lea') expect(v.studio.reasons.join(' ')).toMatch(/can merge/);
        if (want.reason) expect(v.studio.reasons.join(' ')).toMatch(want.reason);
      }
    });
  }

  it('the owner override: an owner the list names may, a listed login who owns nothing may not, everywhere', async () => {
    const ann = await verdicts(pr.t3None!, 'ann');
    const lea = await verdicts(pr.t3None!, 'lea');
    const theo = await verdicts(pr.t3None!, 'theo');
    expect([ann.studio.override, ann.mcp.override, ann.cli.override]).toEqual([true, true, true]);
    expect([lea.studio.override, lea.mcp.override, lea.cli.override]).toEqual([false, false, false]);
    // theo owns tech but the list does not name him.
    expect([theo.studio.override, theo.mcp.override, theo.cli.override]).toEqual([false, false, false]);
  });

  it('a merged branch reads as merged everywhere and lists no approval it no longer waits for', async () => {
    for (const viewer of VIEWERS) {
      const v = await verdicts(pr.mergedNone!, viewer);
      for (const side of [v.studio, v.mcp, v.cli]) expect(side.reasons).toEqual(['This branch is already merged.']);
    }
    const m = (await branches.branchStatus(await as('ann'), { pr: pr.mergedNone! })) as any;
    expect(m.approvalNeeded).toBeNull();
    expect(m.next).toMatch(/^Merged\./);
    gh.viewer.login = 'ann';
    const c = cliIO('ann');
    expect(await runBranch(argv('branch', 'status', String(pr.mergedNone)), dir, c.io)).toBe(0);
    expect(c.out()).toMatch(/^Merged\.$/m);
    expect(c.out()).not.toMatch(/approval|needed|Tests/i);
  });

  it('a branch updated after the changes request waits on the reviewer who asked, everywhere', async () => {
    for (const viewer of VIEWERS) {
      const v = await verdicts(pr.updatedAfter!, viewer);
      expect(v.mcp).toEqual(v.studio);
      expect(v.cli).toEqual(v.studio);
      expect(v.studio.status).toBe('changes-requested');
      expect(v.studio.allowed).toBe(false);
    }
    const reviews = (await (await gh.fetch(`https://api.github.com/repos/${FULL}/pulls/${pr.updatedAfter}/reviews?per_page=100`)).json()) as ReviewLike[];
    const head = gh.pulls[pr.updatedAfter! - 1]!.head.sha;
    expect(lookAgainReviewers(reviews, head, 'agent')).toEqual(['ann']);
    const m = (await branches.branchStatus(await as('agent'), { pr: pr.updatedAfter! })) as any;
    expect(m.approvals.lookAgain).toEqual(['ann']);
    expect(m.next).toMatch(/look again/);
    gh.viewer.login = 'ann';
    const annNeeds = (await branches.whatNeedsMe(await as('ann'))) as any;
    expect(annNeeds.branches.find((b: any) => b.pr === pr.updatedAfter)?.needsYou).toBe('Look again: updated after your changes');
    gh.viewer.login = 'agent';
    const authorNeeds = (await branches.whatNeedsMe(await as('agent'))) as any;
    expect(authorNeeds.branches.find((b: any) => b.pr === pr.updatedAfter)?.needsYou ?? null).toBeNull();
  });

  it('the status says why an applied suggestion counts', async () => {
    gh.viewer.login = 'ann';
    const r = (await branches.branchStatus(await as('ann'), { pr: pr.applyApproved! })) as any;
    expect(r.approvals.carriedFrom).toMatch(new RegExp(`Suggestion #${issue.tier3Approved}`));
    expect(r.approvals.approvedBy).toEqual(expect.arrayContaining(['ann', 'theo']));
    expect(r.approvalNeeded).toBe('Design and tech approval');
    const t1 = (await branches.branchStatus(await as('ann'), { pr: pr.t1NotOwner! })) as any;
    expect(t1.approvalNeeded).toBe('One owner approval');
  });
});

describe('a push from the Figma plugin reads the same in Studio, the MCP server and the CLI', () => {
  for (const [name, want] of [
    ['figmaValues', { status: 'ready', autoShip: true }],
    ['figmaRename', { status: 'needs-tech', autoShip: false }],
  ] as const) {
    it(`${name}: ${want.status}${want.autoShip ? ', ships by itself' : ''}`, async () => {
      for (const viewer of VIEWERS) {
        const m = (await branches.branchStatus(await as(viewer), { pr: pr[name]! })) as any;
        const c = await cliStatus(pr[name]!, viewer);
        const view = (r: any) => ({ status: r.status.kind, allowed: r.merge.allowed, reasons: r.merge.blockedBy, fromFigma: r.fromFigma });
        expect(view(c), `CLI vs MCP, viewer ${viewer}`).toEqual(view(m));
        const v = await verdicts(pr[name]!, viewer);
        expect(v.mcp, `MCP vs Studio, viewer ${viewer}`).toEqual(v.studio);
        expect((await studioReads(pr[name]!, viewer)).autoShip).toBe(want.autoShip);
        expect(m.status.kind).toBe(want.status);
        expect(m.fromFigma.shipsByItself).toBe(want.autoShip);
        expect(m.approvals.design).toBe(true);
        expect(m.approvals.tech).toBe(want.autoShip);
      }
    });
  }

  it('leaves a token push that ships by itself out of what needs me, keeps a rename for the tech owner', async () => {
    const theo = (await branches.whatNeedsMe(await as('theo'), { limit: 50 })) as any;
    expect(theo.branches.some((b: any) => b.pr === pr.figmaValues)).toBe(false);
    expect(theo.branches.find((b: any) => b.pr === pr.figmaRename)?.needsYou).toBe('Your tech approval');
    const ann = (await branches.whatNeedsMe(await as('ann'), { limit: 50 })) as any;
    expect(ann.branches.find((b: any) => b.pr === pr.figmaRename)?.needsYou).toBeNull();
  });
});

describe('merging from the MCP server and the CLI follows the same verdict', () => {
  const LONG = 'Release blocker, the tech owner is away this week';

  it('merges what Studio would merge and refuses what it would refuse (dry runs)', async () => {
    for (const [name, ok] of [
      ['t1Owner', true],
      ['applyApproved', true],
      ['applyTier1', true],
      ['t1NotOwner', false],
      ['applyHalf', false],
      ['applyTierUp', false],
      ['applyAsked', false],
    ] as const) {
      const s = await studioReads(pr[name]!, 'ann');
      expect(s.gate!.allowed, name).toBe(ok);
      const m = (await branches.mergeBranch(await as('ann'), { pr: pr[name]!, dryRun: true })) as any;
      expect(m.status, `MCP ${name}`).toBe(ok ? 'would-merge' : 'blocked');
      const c = cliIO('ann');
      expect(await runBranch(argv('branch', 'merge', String(pr[name]!), '--dry-run'), dir, c.io), `CLI ${name}`).toBe(ok ? 0 : 1);
    }
  });

  it('the override: owners only, a reason always, 20 characters when the config says 0, the same in the MCP tool and the CLI', async () => {
    const n = pr.t3None!;
    // lea is in governance.override.allowed but owns nothing: refused.
    await expect(branches.mergeBranch(await as('lea'), { pr: n, overrideReason: LONG, dryRun: true })).rejects.toThrow(/not allowed to use the owner override: only the owners/);
    const lea = cliIO('lea');
    expect(await runBranch(argv('branch', 'merge', String(n), '--override', LONG, '--dry-run'), dir, lea.io)).toBe(1);
    expect(lea.err()).toMatch(/not allowed to use the owner override/);
    // requireReason false and minReasonLength 0 do not waive the reason: 20 characters.
    await expect(branches.mergeBranch(await as('ann'), { pr: n, overrideReason: 'ship it', dryRun: true })).rejects.toThrow(/at least 20 characters/);
    gh.viewer.login = 'ann';
    await expect(runBranch(argv('branch', 'merge', String(n), '--override', 'ship it', '--dry-run'), dir, cliIO('ann').io)).rejects.toThrow(/at least 20 characters/);
    // Blocked without a reason: the hint names the 20 characters.
    await expect(branches.mergeBranch(await as('ann'), { pr: n })).rejects.toThrow(/at least 20 characters/);
    // An owner the list names, with a reason: the override would go through.
    expect(await branches.mergeBranch(await as('ann'), { pr: n, overrideReason: LONG, dryRun: true })).toMatchObject({ status: 'would-override', skips: ['design approval', 'tech approval'] });
    const ann = cliIO('ann');
    expect(await runBranch(argv('branch', 'merge', String(n), '--override', LONG, '--dry-run'), dir, ann.io)).toBe(0);
    // The override never covers changes requested, even on an applied suggestion.
    await expect(branches.mergeBranch(await as('ann'), { pr: pr.applyAsked!, overrideReason: LONG, dryRun: true })).rejects.toThrow(/only skips missing approvals/);
  });

  it('settings name the owners who may override, as Studio Settings does', async () => {
    const s = (await studio.getSettings(await as('ann'))) as any;
    expect(s.ownerOverride).toMatchObject({ on: true, who: ['@ann'], reason: 'A reason of at least 20 characters, posted on the branch.' });
  });

  it('what needs me asks the Tier 1 approval of owners only', async () => {
    const theo = (await branches.whatNeedsMe(await as('theo'))) as any;
    expect(theo.branches.find((b: any) => b.pr === pr.t1NotOwner)?.needsYou).toBe('Your approval');
    const lea = (await branches.whatNeedsMe(await as('lea'))) as any;
    expect(lea.branches.find((b: any) => b.pr === pr.t1NotOwner)?.needsYou).toBeNull();
  });

  it('wrote nothing to GitHub while checking', () => {
    const merges = gh.log.filter((l) => l.method === 'PUT' && /\/merge$/.test(l.path));
    expect(merges).toEqual([]);
    expect(gh.pulls.filter((p) => p.number !== pr.mergedNone).every((p) => p.state === 'open')).toBe(true);
  });
});
