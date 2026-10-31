// Studio parity over an in-memory GitHub: every action a designer takes on a branch in Bridge Studio, from Claude or
// the terminal, through the same @bridge-ds/core functions (review-gate, branch-actions, library-update, share-branch,
// combine-branches, docs-proposal, products). Reads need no token; writes need one and say how to fix it.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeContext, branches, ops, studio } from '../dist/lib.js';
import { previewComment, tier1PublishReviewBody } from '@bridge-ds/core';
import { addCodeTo, fakeGitHub, pinStart, pinValue, readTree, REAL_PATHS, REPO, withFolderProduct, withoutSoloOwner } from './helpers.js';

const LIGHT = 'packages/tokens/src/semantic/light.tokens.json';
const MUTED = ['color', 'text', 'muted'];
const repoFiles = () => pinStart(readTree(REPO, [...REAL_PATHS, 'packages/react/component-specs.json']));
// A folder product (apps/admin) beside the repo's own products, so the folder-product paths stay covered.
const files = () => withFolderProduct(withoutSoloOwner(repoFiles()));
const edit = (value = '{palette.neutral.700}') => ({ op: 'set' as const, path: 'color.text.muted', value, mode: { theme: 'light' } });

function setup(tree = files()) {
  const gh = fakeGitHub('acme', 'ds', tree);
  const ro = () => BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
  const rw = () => BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
  /** A commit straight on main (someone else's change merged meanwhile). */
  const moveMain = (path: string, text: string) => {
    const head = gh.refs.get('main')!;
    const c = gh.id();
    const next = new Map(gh.commits.get(head)!.files);
    next.set(path, text);
    gh.commits.set(c, { files: next, parents: [head] });
    gh.refs.set('main', c);
  };
  return { gh, ro, rw, moveMain };
}

describe('products', () => {
  it('lists the configured products, the current one, and resolves a name or says which exist', async () => {
    const { ro } = setup();
    const ctx = await ro();
    const r = await branches.listProducts(ctx);
    expect(r.products.map((p) => p.key)).toEqual(['admin', 'admin-app', 'library']);
    expect(r.products.find((p) => p.key === 'library')!.default).toBe(true);
    expect(r.current).toMatchObject({ key: 'library', how: 'default' });
    expect((await branches.resolveProduct(ctx, 'Admin demo')).key).toBe('admin');
    await expect(branches.resolveProduct(ctx, 'checkout')).rejects.toThrow(/Unknown product "checkout"\. Pick one of: admin \(Admin demo\), admin-app \(Product admin\), library \(Library\)/);
  });

  it("Bridge's own config: Product admin in its own repository and the library, no Admin demo", async () => {
    const { ro } = setup(withoutSoloOwner(repoFiles()));
    const r = await branches.listProducts(await ro());
    expect(r.products.map((p) => [p.key, p.name])).toEqual([['admin-app', 'Product admin'], ['library', 'Library']]);
  });

  it('starts work for a product with a Jira key: label, body line, key first in the branch and title', async () => {
    const { gh, rw } = setup();
    const r = (await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()], product: 'admin', jira: 'ds-42' })) as any;
    expect(r).toMatchObject({ status: 'pr-opened', product: 'Admin demo' });
    expect(r.branch).toBe('bridge/DS-42-darken-muted-text');
    expect(gh.pulls[0]!.title).toBe('DS-42 feat(tokens): Darken muted text');
    expect(gh.pulls[0]!.labels.map((l: any) => l.name)).toContain('product: admin');
    expect(gh.pulls[0]!.body).toContain('**Product:** Admin demo');
    await expect(ops.proposeTokenChange(await rw(), { title: 'x', edits: [edit()], jira: 'not a key' })).rejects.toThrow(/like DS-42/);
  });
});

describe('a branch in review, from draft to merged', () => {
  it('send for review, review, merge gate, owner override with its reason on the branch', async () => {
    const { gh, ro, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    expect(gh.pulls[0]).toMatchObject({ draft: true });
    // With code beside the token value, it is no token value change (TV-1): the tech approval is needed.
    addCodeTo(gh, 'bridge/darken-muted-text');

    // Reads work without a token; writes say what the token needs.
    const s0 = (await branches.branchStatus(await ro(), { pr: '#1' })) as any;
    expect(s0).toMatchObject({ pr: 1, lifecycle: 'draft', status: { kind: 'draft' }, product: { key: 'library' } });
    expect(s0.merge.note).toMatch(/Without a GitHub token/);
    await expect(branches.sendForReview(await ro(), { pr: 1 })).rejects.toThrow(/needs a GitHub token with Pull requests: read and write/);
    await expect(branches.branchStatus(await ro(), { pr: 'twelve' })).rejects.toThrow(/not a branch number/);

    // Only the author sends it for review, as in Studio.
    gh.viewer.login = 'someone';
    await expect(branches.sendForReview(await rw(), { pr: 1 })).rejects.toThrow(/Only its author \(@agent\)/);
    gh.viewer.login = 'agent';
    expect(await branches.sendForReview(await rw(), { pr: 1 })).toMatchObject({ status: 'in-review' });
    expect(gh.pulls[0]!.draft).toBe(false);

    // A request for changes needs a text; an approval does not.
    gh.viewer.login = 'peterbono';
    await expect(branches.reviewBranch(await rw(), { pr: 1, decision: 'request_changes' })).rejects.toThrow(/what to change/);
    expect(await branches.reviewBranch(await rw(), { pr: 1, decision: 'approve' })).toMatchObject({ said: 'Approved.' });
    expect(gh.reviews.get(1)![0]).toMatchObject({ state: 'APPROVED', commit_id: gh.refs.get('bridge/darken-muted-text') });

    // One person holds design and tech: their approval covers design only (Studio's rule), so tech is missing.
    const s1 = (await branches.branchStatus(await rw(), { pr: 1 })) as any;
    expect(s1.status.kind).toBe('needs-tech');
    expect(s1.merge).toMatchObject({ allowed: false, you: 'peterbono', ownerOverride: true });
    expect(s1.next).toMatch(/owner override/);

    // Merge: blocked with the reason and the way out; the override needs a long enough reason.
    await expect(branches.mergeBranch(await rw(), { pr: 1 })).rejects.toThrow(/needs a tech owner approval.*overrideReason/);
    await expect(branches.mergeBranch(await rw(), { pr: 1, overrideReason: 'ship it' })).rejects.toThrow(/at least 20 characters/);
    expect(await branches.mergeBranch(await rw(), { pr: 1, overrideReason: 'Release blocker, tech owner on leave this week', dryRun: true })).toMatchObject({ status: 'would-override' });
    expect(gh.pulls[0]!.state).toBe('open');
    const m = (await branches.mergeBranch(await rw(), { pr: 1, overrideReason: 'Release blocker, tech owner on leave this week' })) as any;
    expect(m).toMatchObject({ status: 'merged', override: true });
    expect(gh.pulls[0]).toMatchObject({ state: 'closed', merged: true, merge_method: 'squash' });
    expect(gh.comments.get(1)![0]).toMatch(/^\*\*Bridge owner override\*\*\n\nOwner override by @peterbono: Release blocker, tech owner on leave this week\. Missing: tech approval\. Merged from Bridge\./);
    expect(gh.fileAt('main', LIGHT)).toBe(gh.fileAt('bridge/darken-muted-text', LIGHT));
  });

  it('lets the only owner approve design and tech with governance.soloOwnerCanApproveBoth (this repo)', async () => {
    const { gh, rw } = setup(repoFiles());
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    gh.viewer.login = 'agent';
    await branches.sendForReview(await rw(), { pr: 1 });
    gh.viewer.login = 'peterbono';
    const s0 = (await branches.branchStatus(await rw(), { pr: 1 })) as any;
    expect(s0.approvals.soloOwner).toBe('As the only owner, your approval covers design and code.');
    await branches.reviewBranch(await rw(), { pr: 1, decision: 'approve' });
    const s1 = (await branches.branchStatus(await rw(), { pr: 1 })) as any;
    expect(s1.approvals).toMatchObject({ approvedBy: ['peterbono'], design: true, tech: true });
    expect(s1.status.kind).toBe('ready');
    expect(s1.merge.allowed).toBe(true);
    expect((await studio.getSettings(await rw())).roles).toMatchObject({ soloOwner: 'As the only owner, @peterbono approves design and code in one review.' });
  });

  it('refuses the override to people it does not name, and a plain merge passes once every rule passes', async () => {
    const { gh, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    gh.pulls[0]!.draft = false;
    gh.viewer.login = 'someone';
    await expect(branches.mergeBranch(await rw(), { pr: 1, overrideReason: 'Release blocker, tech owner on leave this week' })).rejects.toThrow(/@someone is not allowed to use the owner override/);
    // Tier 1 (a description only): one approval is enough.
    gh.pulls[0]!.labels = [{ name: 'tier: 1' }];
    gh.pulls[0]!.body = '';
    const mod = (await branches.branchStatus(await rw(), { pr: 1 })) as any;
    // The files still say Tier 3 (highest wins), and a token value change needs the design approval only (TV-1).
    expect(mod.approvalNeeded).toBe('Design approval (token values ship after the checks)');
    gh.viewer.login = 'peterbono';
    await branches.reviewBranch(await rw(), { pr: 1, decision: 'approve' });
    // Decision TV-1: the design approval alone makes a token value change ready, no developer OK.
    expect(((await branches.branchStatus(await rw(), { pr: 1 })) as any).status.kind).toBe('ready');
    gh.viewer.login = 'tech-person';
    await branches.reviewBranch(await rw(), { pr: 1, decision: 'approve', body: 'Looks right.' });
    gh.viewer.login = 'peterbono';
    // With a second approver, peterbono's approval covers tech too: every rule passes, a plain merge goes through.
    expect(((await branches.branchStatus(await rw(), { pr: 1 })) as any).status.kind).toBe('ready');
    expect(await branches.mergeBranch(await rw(), { pr: 1 })).toMatchObject({ status: 'merged' });
    expect(gh.pulls[0]).toMatchObject({ merged: true, merge_method: 'squash' });
    expect(gh.comments.get(1) ?? []).toEqual([]);
  });

  it('back to draft, close and reopen with Studio rules; comment and reply', async () => {
    const { gh, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    gh.pulls[0]!.draft = false;
    gh.viewer.login = 'someone';
    await expect(branches.backToDraft(await rw(), { pr: 1 })).rejects.toThrow(/Only its author/);
    gh.viewer.login = 'agent';
    expect(await branches.backToDraft(await rw(), { pr: 1 })).toMatchObject({ status: 'draft' });
    gh.pulls[0]!.draft = false;

    expect(await branches.closeBranch(await rw(), { pr: 1 })).toMatchObject({ status: 'closed' });
    expect(gh.pulls[0]!.state).toBe('closed');
    gh.viewer.login = 'someone';
    await expect(branches.reopenBranch(await rw(), { pr: 1 })).rejects.toThrow(/Only its author \(@agent\) or an owner/);
    gh.viewer.login = 'agent';
    expect(await branches.reopenBranch(await rw(), { pr: 1 })).toMatchObject({ status: 'open' });
    expect(gh.pulls[0]!.state).toBe('open');

    expect(await branches.commentOnBranch(await rw(), { pr: 1, body: 'Can we check dark mode too?' })).toMatchObject({ said: 'Comment posted.' });
    gh.lineComments.set(1, [{ id: 42, body: 'Why 700?', user: { login: 'peterbono' }, path: LIGHT, line: 15, html_url: 'x', created_at: '' }]);
    const list = (await branches.listComments(await rw(), { pr: 1 })) as any;
    expect(list.conversation[0].body).toBe('Can we check dark mode too?');
    expect(list.threads[0]).toMatchObject({ id: 42, file: LIGHT });
    expect(await branches.commentOnBranch(await rw(), { pr: 1, body: 'It passes AA on raised surfaces.', replyTo: 42 })).toMatchObject({ replied: 42 });
    expect(gh.lineComments.get(1)!.at(-1)).toMatchObject({ in_reply_to_id: 42, body: 'It passes AA on raised surfaces.' });
    await expect(branches.commentOnBranch(await rw(), { pr: 1, body: '  ' })).rejects.toThrow(/Write the comment first/);
  });

  it('asks someone else to review: the owners who can give the missing approvals, never the viewer or the author', async () => {
    const { gh, ro, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    await expect(branches.askSomeoneElse(await rw(), { pr: 1 })).rejects.toThrow(/a draft: send it for review first/);
    gh.pulls[0]!.draft = false;
    gh.pulls[0]!.requested_reviewers = [{ login: 'someone' }];
    gh.viewer.login = 'someone';
    expect(await branches.askSomeoneElse(await rw(), { pr: 1, dryRun: true })).toMatchObject({ status: 'would-ask', asks: ['@peterbono'] });
    await expect(branches.askSomeoneElse(await ro(), { pr: 1 })).rejects.toThrow(/needs a GitHub token/);
    expect(await branches.askSomeoneElse(await rw(), { pr: 1 })).toMatchObject({ status: 'asked', said: 'Asked @peterbono to review.' });
    expect(gh.pulls[0]!.requested_reviewers).toEqual([{ login: 'peterbono' }]);
    gh.viewer.login = 'peterbono';
    await expect(branches.askSomeoneElse(await rw(), { pr: 1 })).rejects.toThrow(/Nobody else can give the missing approval/);
  });

  it('adds token edits to a branch in review: one commit there, a comment for reviewers', async () => {
    const { gh, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    gh.viewer.login = 'agent';
    const r = (await ops.proposeTokenChange(await rw(), { title: 'Even darker', edits: [edit('{palette.neutral.800}')], pr: 1 })) as any;
    expect(r).toMatchObject({ status: 'added', pr: 1, branch: 'bridge/darken-muted-text' });
    expect(gh.pulls).toHaveLength(1);
    expect(gh.fileAt('bridge/darken-muted-text', LIGHT)).toContain('{palette.neutral.800}');
    expect(gh.comments.get(1)!.at(-1)).toMatch(/@agent added token edits from an AI tool through the Bridge MCP server/);
    gh.viewer.login = 'someone';
    gh.viewer.login = 'agent';
    await expect(ops.proposeTokenChange(await rw(), { title: 'x', edits: [edit()], pr: 1, branch: 'explore/x' })).rejects.toThrow(/not both/);
  });
});

describe('update from main', () => {
  it('no conflict: GitHub updates the branch; a token conflict: pick per token, then one resolution commit', async () => {
    const { gh, rw, moveMain } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    gh.viewer.login = 'agent';
    expect(await branches.updateFromMain(await rw(), { pr: 1 })).toMatchObject({ status: 'up-to-date' });

    // Someone changed another file on main: behind, nothing conflicts.
    moveMain('docs/GOVERNANCE.md', `${gh.fileAt('main', 'docs/GOVERNANCE.md')}\nOne more line.\n`);
    expect(await branches.updateFromMain(await rw(), { pr: 1, dryRun: true })).toMatchObject({ status: 'would-update', behindBy: 1 });
    expect(await branches.updateFromMain(await rw(), { pr: 1 })).toMatchObject({ status: 'updated' });
    expect(gh.fileAt('bridge/darken-muted-text', 'docs/GOVERNANCE.md')).toContain('One more line.');

    // Main set the same token to another value: a token conflict the designer settles.
    moveMain(LIGHT, pinValue(gh.fileAt('main', LIGHT)!, MUTED, '{palette.neutral.800}'));
    const dry = (await branches.updateFromMain(await rw(), { pr: 1, dryRun: true })) as any;
    expect(dry.status).toBe('token-conflicts');
    expect(dry.conflicts).toHaveLength(1);
    expect(dry.conflicts[0]).toMatchObject({ token: 'color.text.muted', default: 'mine' });
    const key = dry.conflicts[0].key as string;
    const done = (await branches.updateFromMain(await rw(), { pr: 1, choices: { [key]: 'theirs' } })) as any;
    expect(done.status).toBe('resolved');
    const after = gh.fileAt('bridge/darken-muted-text', LIGHT)!;
    expect(after).toContain('"$value": "{palette.neutral.800}"');
    expect(gh.commits.get(gh.refs.get('bridge/darken-muted-text')!)!.parents).toHaveLength(2);
  });

  it('code conflicts stay with a developer', async () => {
    const { gh, rw, moveMain } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    // The branch and main both edit a code file.
    const head = gh.refs.get('bridge/darken-muted-text')!;
    const c = gh.id();
    const next = new Map(gh.commits.get(head)!.files);
    next.set('AGENTS.md', 'branch version\n');
    gh.commits.set(c, { files: next, parents: [head] });
    gh.refs.set('bridge/darken-muted-text', c);
    moveMain('AGENTS.md', 'main version\n');
    await expect(branches.updateFromMain(await rw(), { pr: 1 })).rejects.toThrow(/conflicts with main in code \(AGENTS\.md\)\. A developer resolves that on GitHub/);
  });
});

describe('what needs me, try it, share it, combine', () => {
  it('flags the approvals the viewer can give and leaves explorations and the release out', async () => {
    const { gh, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    gh.pulls[0]!.draft = false;
    await ops.proposeTokenChange(await rw(), { title: 'Exploration edit', edits: [edit('{palette.neutral.800}')] });
    gh.pulls[1]!.labels.push({ name: 'exploration' });
    gh.viewer.login = 'peterbono';
    const r = (await branches.whatNeedsMe(await rw(), {})) as any;
    expect(r.branches.map((b: any) => b.pr)).toEqual([1]);
    expect(r.branches[0]).toMatchObject({ status: 'needs-design', needsYou: 'Your design approval' });
    expect(r.summary).toBe('1 branch needs you; 1 in review.');
    const anon = (await branches.whatNeedsMe(await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch }), {})) as any;
    expect(anon.summary).toMatch(/Set a GitHub token/);
  });

  it('try it in a product and share it: never a guessed link, the install command once posted', async () => {
    const { gh, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    const t = (await branches.tryBranch(await rw(), { pr: 1 })) as any;
    expect(t.tryInProduct.find((p: any) => p.key === 'admin')).toMatchObject({ url: null, how: 'no preview reported yet' });
    expect(t.share).toMatchObject({ state: 'building', install: null });
    const sha = gh.refs.get('bridge/darken-muted-text')!;
    gh.comments.set(1, [previewComment({ owner: 'acme', repo: 'ds', pr: 1, branch: 'bridge/darken-muted-text', sha, packages: [{ name: '@bridge-ds/tokens', url: 'https://example.test/tokens.tgz' }], source: 'release', apps: {} })]);
    const shared = (await branches.tryBranch(await rw(), { pr: 1 })) as any;
    expect(shared.share).toMatchObject({ state: 'ready', install: 'npm i https://example.test/tokens.tgz' });
    expect(shared.share.message.body).toContain('npm i https://example.test/tokens.tgz');
  });

  it('combines 2 to 4 token branches: conflicts to pick, links to open, code refused', async () => {
    const { gh, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    await ops.proposeTokenChange(await rw(), { title: 'Darker muted text', edits: [edit('{palette.neutral.800}')] });
    await expect(branches.combineBranches(await rw(), { prs: [1] })).rejects.toThrow(/Pick 2 to 4 branches/);
    const c = (await branches.combineBranches(await rw(), { prs: [1, '#2'] })) as any;
    expect(c.conflicts).toHaveLength(1);
    expect(c.missingPicks).toBe(1);
    expect(c.open.product).toBe('https://bridge-demo.floriangouloubi.com/?bridge=1,2');
    const picked = (await branches.combineBranches(await rw(), { prs: [1, 2], picks: { [c.conflicts[0].key]: 2 } })) as any;
    expect(picked.missingPicks).toBe(0);
    expect(picked.open.product).toContain('bridge-use=');
    expect(gh.pulls).toHaveLength(2);
  });
});

describe('docs, settings, Figma coverage', () => {
  it('saves guidance on a new branch with the Library editor rules, or on an open one', async () => {
    const { gh, ro, rw } = setup();
    await expect(studio.saveDocs(await rw(), { component: 'Button', docs: { summary: 'Starts an action — fast.' } })).rejects.toThrow(/em dashes/);
    await expect(studio.saveDocs(await rw(), { component: 'Button', docs: { title: 'x' } })).rejects.toThrow(/Unknown docs sections: title/);
    await expect(studio.saveDocs(await rw(), { component: 'button', docs: {} })).rejects.toThrow(/not a component name/);
    const preview = (await studio.saveDocs(await ro(), { component: 'Button', docs: { summary: 'Starts an action in one click.' } })) as any;
    expect(preview).toMatchObject({ status: 'preview' });
    expect(preview.said).toMatch(/needs a GitHub token/);
    const r = (await studio.saveDocs(await rw(), { component: 'Button', docs: { summary: 'Starts an action in one click.' }, jira: 'DS-7', product: 'admin' })) as any;
    expect(r).toMatchObject({ status: 'sent-for-review', pr: 1, product: 'Admin demo' });
    const pr = gh.pulls[0]!;
    expect(pr.title).toMatch(/^DS-7 docs\(button\)/);
    expect(pr.head.ref).toMatch(/^docs\/DS-7-button-/);
    expect(pr.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['docs', 'source: mcp', 'product: admin']));
    const path = 'packages/react/src/components/Button/Button.docs.json';
    expect(JSON.parse(gh.fileAt(pr.head.ref, path)!).summary).toBe('Starts an action in one click.');
    // The rest of the docs stay as they were.
    expect(JSON.parse(gh.fileAt(pr.head.ref, path)!).dos).toEqual(JSON.parse(gh.fileAt('main', path)!).dos);
    const again = (await studio.saveDocs(await rw(), { component: 'Button', docs: { summary: 'Starts one action.' }, pr: 1 })) as any;
    expect(again).toMatchObject({ status: 'committed', pr: 1 });
    expect(JSON.parse(gh.fileAt(pr.head.ref, path)!).summary).toBe('Starts one action.');
    // One open docs proposal per component: without pr, the open one is continued, not a second pull request.
    const joined = (await studio.saveDocs(await rw(), { component: 'Button', docs: { summary: 'Starts one action, now.' } })) as any;
    expect(joined).toMatchObject({ status: 'committed', pr: 1, continued: true });
    expect(joined.said).toMatch(/continues the open Button docs proposal/);
    expect(gh.pulls).toHaveLength(1);
    expect(JSON.parse(gh.fileAt(pr.head.ref, path)!).summary).toBe('Starts one action, now.');
  });

  it('says a Tier 1 change a lead published without review, only for the review on the head commit', async () => {
    const { gh, rw } = setup();
    await studio.saveDocs(await rw(), { component: 'Button', docs: { summary: 'Starts an action in one click.' } });
    const pr = gh.pulls[0]!;
    pr.draft = false;
    pr.auto_merge = { merge_method: 'squash' };
    const review = (commit: string) => ({ id: 990, user: { login: 'bridge-ds[bot]' }, commit_id: commit, state: 'APPROVED', body: tier1PublishReviewBody('Dana Reyes', 'dana'), submitted_at: '2026-10-16T00:00:00Z' });
    gh.reviews.set(1, [review('an-older-commit')]);
    expect(((await branches.branchStatus(await rw(), { pr: 1 })) as any).published).toBeUndefined();
    gh.reviews.set(1, [review(pr.head.sha)]);
    const s = (await branches.branchStatus(await rw(), { pr: 1 })) as any;
    expect(s.published).toBe('Published by Dana Reyes without review (Tier 1).');
  });

  it('says who publishes small changes without review, on by default and off when the team turns it off', async () => {
    const { ro } = setup();
    expect(((await studio.getSettings(await ro())) as any).roles.tier1Publish).toMatch(/team admins and the reviewers of that part publish it without review/);
    const tree = files();
    const cfg = JSON.parse(tree['bridge.config.json']!);
    cfg.governance = { ...cfg.governance, leadsPublishTier1: false };
    const off = setup({ ...tree, 'bridge.config.json': `${JSON.stringify(cfg, null, 2)}\n` });
    expect(((await studio.getSettings(await off.ro())) as any).roles.tier1Publish).toBe('Tier 1 needs one owner approval: leads publishing small changes without review is off.');
  });

  it('reads settings safely and the Figma coverage in Studio words', async () => {
    const { ro } = setup();
    const s = (await studio.getSettings(await ro())) as any;
    expect(s.roles.designApproval).toEqual(['@peterbono']);
    expect(s.ownerOverride).toMatchObject({ on: true, who: ['@peterbono'] });
    expect(s.products.map((p: any) => p.key)).toEqual(['admin', 'admin-app', 'library']);
    expect(Object.keys(s)).not.toContain('token');
    expect(JSON.stringify(s)).not.toMatch(/"t"|Bearer/);
    const f = (await studio.figmaCoverage(await ro(), { component: 'Button' })) as any;
    expect(f.components).toEqual([{ name: 'Button', inFigma: 'Yes' }]);
    // One component count: the folders, as snapshot.json counts them; the other numbers say what they are.
    const folders = readdirSync(join(REPO, 'packages/react/src/components')).length;
    expect(f.summary).toMatch(new RegExp(`^\\d+ of the ${folders} components are in Figma`));
    expect(f.summary).toMatch(/layout helpers, built with auto layout/);
    expect(f.summary).toMatch(/component sets: popups, items/);
    expect(f.fidelity).toMatch(/No code images/);
    await expect(studio.figmaCoverage(await ro(), { component: 'Nope' })).rejects.toThrow(/not in the coverage list/);
  });
});

describe('one status, the same in what needs me and branch status (core reviewStatusKind)', () => {
  /** A repo with no CI at all, where GitHub has not computed whether pull requests merge cleanly yet. */
  const noChecks = (fetch: typeof globalThis.fetch): typeof globalThis.fetch =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (/\/commits\/[^/]+\/check-runs/.test(url)) return json({ total_count: 0, check_runs: [] });
      if (/\/commits\/[^/]+\/status$/.test(url)) return json({ state: 'pending', statuses: [] });
      const r = await fetch(input, init);
      if ((init?.method ?? 'GET') === 'GET' && /\/pulls\/\d+$/.test(url) && r.ok) return json({ ...(await r.json()), mergeable: null });
      return r;
    }) as typeof globalThis.fetch;

  it('no checks and mergeable not computed: needs design approval everywhere, never "Checking" or unknown', async () => {
    const { gh, rw } = setup();
    await ops.proposeTokenChange(await rw(), { title: 'Darken muted text', edits: [edit()] });
    gh.pulls[0]!.draft = false;
    gh.viewer.login = 'peterbono';
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: noChecks(gh.fetch) });
    const needs = (await branches.whatNeedsMe(ctx, {})) as any;
    expect(needs.branches[0]).toMatchObject({ pr: 1, status: 'needs-design', statusLabel: 'Needs design approval' });
    const one = (await branches.branchStatus(ctx, { pr: 1 })) as any;
    expect(one.status).toEqual({ kind: 'needs-design', label: 'Needs design approval' });
    expect(one.tests).toMatchObject({ state: 'none', label: 'No automated checks' });
  });
});
