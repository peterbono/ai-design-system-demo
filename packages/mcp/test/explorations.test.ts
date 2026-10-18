// Explorations over an in-memory GitHub and a throwaway local repo: start (draft pull request labeled exploration),
// list with linked requests, token edits and request briefs aimed at the exploration branch, promote and close.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeContext, explorations, ops, requests } from '../dist/lib.js';
import { fakeGitHub, git, pinStart, readTree, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

// pinStart: muted text starts at 600, so the edit to 700 is a real change whatever main says.
const files = () => pinStart(readTree(REPO, REAL_PATHS));
const edit = { op: 'set' as const, path: 'color.text.muted', value: '{palette.neutral.700}', mode: { theme: 'light' } };
const LIGHT = 'packages/tokens/src/semantic/light.tokens.json';

describe('explorations on GitHub', () => {
  it('start: dry run and refusal without a token; branch, note and draft pull request labeled exploration with one', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const ro = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
    const dry = (await explorations.startExploration(ro, { name: 'Pill buttons', purpose: 'Do rounder buttons feel friendlier in checkout?', useCase: 'user-test', dryRun: true })) as any;
    expect(dry).toMatchObject({ status: 'dry-run', branch: 'explore/pill-buttons', title: 'Exploration: pill buttons', label: 'exploration' });
    expect(dry.note.path).toBe('.bridge/explorations/pill-buttons.md');
    await expect(explorations.startExploration(ro, { name: 'Pill buttons', purpose: 'x' })).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(explorations.startExploration(ro, { name: '', purpose: '' })).rejects.toThrow(/Name the exploration/);
    await expect(explorations.startExploration(ro, { name: 'X1', purpose: 'y', useCase: 'nope' })).rejects.toThrow(/Unknown use case/);
    expect(gh.pulls).toHaveLength(0);

    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
    const r = (await explorations.startExploration(ctx, { name: 'Pill buttons', purpose: 'Do rounder buttons feel friendlier in checkout?', useCase: 'user-test' })) as any;
    expect(r).toMatchObject({ status: 'started', branch: 'explore/pill-buttons', pr: 1 });
    // Nothing built yet: no guessed pkg.pr.new command, the note says where it will appear.
    expect(r.install).toMatchObject({ state: 'building', command: null });
    expect(JSON.stringify(r)).not.toContain('pkg.pr.new');
    expect(r.next).toContain('"branch": "explore/pill-buttons"');
    expect(gh.pulls[0]).toMatchObject({ draft: true, base: { ref: 'main' }, title: 'Exploration: pill buttons' });
    expect(gh.pulls[0]!.labels.map((l: any) => l.name)).toEqual(['exploration']);
    expect(gh.fileAt('explore/pill-buttons', '.bridge/explorations/pill-buttons.md')).toContain('Do rounder buttons');
    expect(gh.fileAt('main', '.bridge/explorations/pill-buttons.md')).toBeUndefined();
  });

  it('token edits, requests and docs drafts aimed at the exploration branch; list; promote', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
    await explorations.startExploration(ctx, { name: 'Pill buttons', purpose: 'Rounder buttons.' });
    const mainLight = gh.fileAt('main', LIGHT);

    // Token edit: one commit on the exploration, no new pull request, main untouched.
    const p = (await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [edit], branch: 'explore/pill-buttons' })) as any;
    expect(p).toMatchObject({ status: 'committed', branch: 'explore/pill-buttons', exploration: true, pr: 1 });
    expect(gh.pulls).toHaveLength(1);
    expect(gh.fileAt('explore/pill-buttons', LIGHT)).not.toBe(mainLight);
    expect(gh.fileAt('main', LIGHT)).toBe(mainLight);
    await expect(ops.proposeTokenChange(ctx, { title: 'x', edits: [edit], branch: 'agent/x' })).rejects.toThrow(/not an exploration branch/);
    await expect(ops.proposeTokenChange(ctx, { title: 'x', edits: [edit], branch: 'explore/missing' })).rejects.toThrow(/not found/);
    await expect(ops.proposeTokenChange(ctx, { title: 'x', edits: [edit], branch: 'main' })).rejects.toThrow(/not an exploration branch|protected/);

    // A request on the exploration: labeled, and its brief says to work there.
    const req = (await requests.createRequest(ctx, { component: 'Button', kind: 'visual', title: 'Pill radius', summary: 'Try a pill radius.', exploration: 'pill-buttons' })) as any;
    expect(req.labels).toContain('exploration');
    expect(req.next).toContain('explore/pill-buttons');
    const got = await requests.getRequest(ctx, { number: req.number });
    expect(got.exploration).toBe('explore/pill-buttons');
    expect(got.brief).toContain('Work on the existing branch explore/pill-buttons');
    expect(got.brief).toContain('Do not open a pull request to main');
    expect(got.next).toContain('Do not open a pull request to main');
    const plain = await requests.createRequest(ctx, { component: 'Switch', kind: 'visual', title: 'Bigger', summary: 'Bigger.' });
    const aimed = await requests.getRequest(ctx, { number: (plain as any).number, branch: 'explore/pill-buttons' });
    expect(aimed.brief).toContain('explore/pill-buttons');
    expect((await requests.listRequests(ctx, {})).requests.find((r) => r.number === req.number)!.exploration).toBe('explore/pill-buttons');

    // Docs draft on the exploration: read there, saved there.
    const d = (await ops.draftDocsOp(ctx, { name: 'Button', branch: 'explore/pill-buttons' })) as any;
    expect(d.branch).toBe('explore/pill-buttons');
    expect(d.instruction).toContain('on the exploration branch explore/pill-buttons');

    const list = await explorations.listExplorations(ctx, {});
    expect(list).toMatchObject({ running: 1, total: 1, summary: '1 exploration running.' });
    expect(list.explorations[0]).toMatchObject({ number: 1, slug: 'pill-buttons', status: 'active', purpose: 'Rounder buttons.' });
    expect(list.explorations[0]!.requests.map((r) => r.number)).toEqual([req.number]);

    const dry = (await explorations.promoteExploration(ctx, { ref: 'pill-buttons', dryRun: true })) as any;
    expect(dry).toMatchObject({ status: 'dry-run', tier: 3, closes: [req.number] });
    expect(gh.pulls[0]!.draft).toBe(true);

    const done = (await explorations.promoteExploration(ctx, { ref: 'explore/pill-buttons' })) as any;
    expect(done).toMatchObject({ status: 'promoted', number: 1, tier: 3, warnings: [] });
    expect(gh.pulls[0]!.draft).toBe(false);
    expect(gh.pulls[0]!.labels.map((l: any) => l.name).sort()).toEqual(['tier: 3', 'tokens']);
    expect(gh.pulls[0]!.body).toContain(`Closes #${req.number}`);
    expect(gh.fileAt('explore/pill-buttons', '.bridge/explorations/pill-buttons.md')).toBeUndefined();
    expect((await explorations.listExplorations(ctx, {})).summary).toBe('No exploration running.');
  });

  it('list: the install command from the preview comment and the preview URLs Vercel reports, never guessed', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
    await explorations.startExploration(ctx, { name: 'Button normal again', purpose: 'Back to the regular button.' });
    const before = (await explorations.listExplorations(ctx, {})).explorations[0] as any;
    expect(before.install).toMatchObject({ state: 'building', command: null });
    // The admin template would be 64 characters: Vercel shortens it, so it stays unknown until Vercel reports it.
    expect(before.previews.map((p: any) => [p.app, p.url])).toEqual([
      ['docs', 'https://bridge-docs-git-explore-button-normal-again-peterbonos-projects.vercel.app/'],
      ['storybook', null],
      ['admin', null],
    ]);
    const admin = 'bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app';
    const storybook = 'bridge-storybook-git-explore-button-8a43de-peterbonos-projects.vercel.app';
    const vc = Buffer.from(JSON.stringify({ projects: [{ name: 'bridge-admin', previewUrl: admin, nextCommitStatus: 'DEPLOYED' }, { name: 'bridge-storybook', previewUrl: storybook, nextCommitStatus: 'BUILDING' }] })).toString('base64');
    const command = 'npm i @bridge-ds/react@https://github.com/acme/ds/releases/download/preview-pr-1/bridge-ds-react-abc1234.tgz';
    gh.comments.set(1, [`[vc]: #abc:${vc}\nThe latest updates on your projects.`, `<!-- bridge-branch-preview -->\n## Try this exploration in your product\n\n\`\`\`sh\n${command}\n\`\`\`\n`]);
    const after = (await explorations.listExplorations(ctx, {})).explorations[0] as any;
    expect(after.install).toMatchObject({ state: 'ready', command });
    expect(after.previews.find((p: any) => p.app === 'admin')).toMatchObject({ url: `https://${admin}/`, state: 'ready' });
    expect(after.previews.find((p: any) => p.app === 'storybook')).toMatchObject({ url: `https://${storybook}/`, state: 'building' });
    expect(JSON.stringify(after)).not.toContain('pkg.pr.new');
  });

  it('close, and read-only refusals', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
    await explorations.startExploration(ctx, { name: 'Dense tables', purpose: 'Compact rows.' });
    const ro = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
    await expect(explorations.promoteExploration(ro, { ref: 'dense-tables' })).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(explorations.closeExploration(ro, { ref: 'dense-tables' })).rejects.toThrow(/GITHUB_TOKEN/);
    expect(await explorations.closeExploration(ctx, { ref: '#1' })).toMatchObject({ status: 'closed', number: 1, branch: 'explore/dense-tables' });
    expect(gh.pulls[0]!.state).toBe('closed');
    expect((await explorations.listExplorations(ctx, { state: 'all' })).explorations[0]!.status).toBe('closed');
  });
});

describe('explorations in a local repo', () => {
  it('start makes a local branch only; token edits need the branch checked out and land in the working tree', async () => {
    const dir = tempGitRepo(REPO, REAL_PATHS);
    const ctx = await BridgeContext.create({ root: dir });
    const r = (await explorations.startExploration(ctx, { name: 'Warm neutrals', purpose: 'Do warmer greys calm the dashboard?' })) as any;
    expect(r).toMatchObject({ status: 'branch-created', branch: 'explore/warm-neutrals' });
    expect(r.next).toContain('git push -u origin explore/warm-neutrals');
    expect(git(dir, 'show', 'explore/warm-neutrals:.bridge/explorations/warm-neutrals.md')).toContain('# Exploration: Warm neutrals');
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    await expect(explorations.startExploration(ctx, { name: 'Warm neutrals', purpose: 'Again.' })).rejects.toThrow(/already exists/);

    await expect(ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [edit], branch: 'explore/warm-neutrals' })).rejects.toThrow(/git switch explore\/warm-neutrals/);
    execFileSync('git', ['switch', '-q', 'explore/warm-neutrals'], { cwd: dir });
    const before = readFileSync(join(dir, LIGHT), 'utf8');
    const p = (await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [edit], branch: 'explore/warm-neutrals' })) as any;
    expect(p).toMatchObject({ status: 'written', branch: 'explore/warm-neutrals' });
    expect(p.next).toContain('Do not open a pull request to main');
    expect(readFileSync(join(dir, LIGHT), 'utf8')).not.toBe(before);
    // No bridge/* branch was created: the edits stay on the exploration.
    expect(git(dir, 'branch', '--list', 'bridge/*').trim()).toBe('');
  });
});
