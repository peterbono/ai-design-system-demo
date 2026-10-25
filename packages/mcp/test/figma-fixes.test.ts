// Fix with Claude through the MCP server, over an in-memory GitHub (no token leaves, no real repo): the gaps, one gap
// case with the schema, the values referee round by round, and the change for review, like other Bridge changes from
// MCP (a draft pull request labelled drafted-by-claude), on a real Carbon measure and a Check fidelity run the plugin
// saved on the requests branch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { BridgeContext, createServer, figmaFixes } from '../src/lib.js';
import { fakeGitHub, git, readTree, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

const GAP = join(REPO, 'packages/core/test/fixtures/gap');
// The loop's scenario: the measure without the boxes of TextInput's label row and field group, which would let the pull
// keep their heights by itself (a gap the build cannot see, that fixes close). The gap case's wording needs them.
const MEASURED = readFileSync(join(GAP, 'carbon-measured-hidden-boxes.json'), 'utf8');
const MEASURED_WITH_BOXES = readFileSync(join(GAP, 'carbon-measured.json'), 'utf8');
const RUN = readFileSync(join(GAP, 'textinput-fidelity.json'), 'utf8');

const labelFixed = { id: 'textinput-label-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', height: 'fixed', reason: 'Carbon keeps 24 px for the label row; Figma hugged the 16 px label.', by: 'claude' };
const outerFixed = { id: 'textinput-field-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-field-outer-wrapper', height: 'fixed', reason: 'The field and its helper keep their measured height with the 4 px gap.', by: 'claude' };
const SUMMARY = 'TextInput keeps its label row and field heights, as in Carbon.';

/** The repo on GitHub, with the measure on main and the plugin's run on the requests branch. */
function setup(extra: Record<string, string> = {}) {
  const gh = fakeGitHub('acme', 'ds', { ...readTree(REPO, REAL_PATHS), 'measured-specs.json': MEASURED, ...extra });
  const main = gh.refs.get('main')!;
  const sha = gh.id();
  gh.commits.set(sha, { files: new Map([...gh.commits.get(main)!.files, ['figma-fidelity.json', RUN]]), parents: [main] });
  gh.refs.set('bridge-requests', sha);
  const ro = () => BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
  const rw = () => BridgeContext.create({ repo: 'acme/ds', token: 't', fetch: gh.fetch });
  return { gh, ro, rw };
}

const labels = (pr: any) => pr.labels.map((l: any) => l.name);

describe('bridge_figma_gaps', () => {
  it('reads the plugin\'s run from the requests branch and lists Differs and Can\'t check', async () => {
    const { ro } = setup();
    const r = await figmaFixes.figmaGapsOp(await ro());
    expect(r).toMatchObject({ referee: 'shots', report: 'figma-fidelity.json on bridge-requests' });
    expect(r.gaps.map((g) => `${g.component} ${g.status}`)).toEqual(['TextInput differs', "IconButton cant-check"]);
    expect(r.next).toMatch(/bridge_get_gap_case \{ component: "TextInput" \}/);
  });

  it('without a run, says how to make one and falls back to the measure', async () => {
    const gh = fakeGitHub('acme', 'ds', { ...readTree(REPO, REAL_PATHS), 'measured-specs.json': MEASURED });
    const r = await figmaFixes.figmaGapsOp(await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch }));
    expect(r.referee).toBe('values');
    expect('note' in r && r.note).toMatch(/run Check fidelity, then Fix with Claude/);
  });

  it('without a measure, says how to measure', async () => {
    const gh = fakeGitHub('acme', 'ds', readTree(REPO, REAL_PATHS));
    await expect(figmaFixes.figmaGapsOp(await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch }))).rejects.toThrow(/bridge specs --measure --variants --shots/);
  });
});

describe('bridge_get_gap_case', () => {
  it('gives the gap case with deltas and the fix schema', async () => {
    const { ro } = setup({ 'measured-specs.json': MEASURED_WITH_BOXES });
    const r = await figmaFixes.getGapCaseOp(await ro(), { component: 'textinput' });
    expect(r.gap.summary).toMatch(/Height 72 in Figma vs 84 in code: 8 px missing below the label/);
    expect(r.gap.variants[0]!.differences[0]).toMatchObject({ part: 'root', property: 'height', expected: 84, actual: 72, delta: -12 });
    expect(r.schema).toMatch(/kind "status"/);
    expect(r.rounds).toEqual({ used: 0, max: 3 });
    expect(r.next).toMatch(/bridge_try_figma_fix/);
    await expect(figmaFixes.getGapCaseOp(await ro(), { component: 'Nope' })).rejects.toThrow(/No measured story of Nope/);
  });
});

describe('bridge_try_figma_fix', () => {
  it('round by round: closer, then resolved; after 3 rounds without closer, a status fix', async () => {
    const { ro, gh } = setup();
    const ctx = await ro();
    const one = await figmaFixes.tryFigmaFixOp(ctx, { component: 'TextInput', fixes: [labelFixed] });
    expect(one).toMatchObject({ status: 'checked', verdict: 'closer', round: 1, roundsLeft: 2 });
    expect(one.variants[0]!.differences[0]).toMatchObject({ before: 72, after: 80, result: 'closer' });
    expect(one.pixelCheck).toMatch(/Check fidelity/);
    const two = await figmaFixes.tryFigmaFixOp(ctx, { component: 'TextInput', fixes: [labelFixed, outerFixed] });
    expect(two.variants[0]!.differences[0]).toMatchObject({ after: 84, result: 'resolved' });
    expect(two.next).toMatch(/bridge_propose_figma_fixes/);
    const three = await figmaFixes.tryFigmaFixOp(ctx, { component: 'TextInput', fixes: [{ ...labelFixed, height: 'hug' }] });
    expect(three.round).toBe(3);
    expect(three.verdict).toBe('same');
    expect(three.next).toMatch(/propose a status fix instead/);
    // Nothing written anywhere.
    expect(gh.pulls).toHaveLength(0);
    expect(gh.log.filter((l) => l.method !== 'GET')).toEqual([]);
  });

  it('invalid fixes come back with every problem', async () => {
    const { ro } = setup();
    const r = await figmaFixes.tryFigmaFixOp(await ro(), { component: 'TextInput', fixes: [{ ...labelFixed, reason: 'Too short \u2014 no' }] });
    expect(r.status).toBe('invalid');
    expect(r.problems).toEqual(['fix textinput-label-height: reason uses an em dash: use a colon or a comma']);
  });
});

describe('bridge_propose_figma_fixes', () => {
  it('read only: a preview; with a token: a draft pull request labelled drafted-by-claude with the deltas', async () => {
    const { gh, ro, rw } = setup();
    const preview = await figmaFixes.proposeFigmaFixesOp(await ro(), { component: 'TextInput', fixes: [labelFixed, outerFixed], summary: SUMMARY });
    expect(preview.status).toBe('preview');
    expect(gh.pulls).toHaveLength(0);

    const r = await figmaFixes.proposeFigmaFixesOp(await rw(), { component: 'TextInput', fixes: [labelFixed, outerFixed], summary: SUMMARY, source: 'mcp' });
    expect(r).toMatchObject({ status: 'pr-opened', verdict: 'closer', tier: 2, draft: true, branch: 'bridge/figma-fixes-text-input' });
    const pr = gh.pulls[0]!;
    expect(labels(pr)).toEqual(expect.arrayContaining(['tier: 2', 'source: mcp', 'figma-fixes', 'drafted-by-claude']));
    expect(pr.title).toBe('fix(figma): TextInput drawn closer to its story');
    expect(pr.body).toContain(SUMMARY);
    expect(pr.body).toContain('Height 72 in Figma vs 84 in code');
    expect(pr.body).toContain('`textinput-field-height` (part)');
    expect(pr.body).toContain('resolved (-12 px, now 0 px, estimated)');
    expect(pr.body).not.toMatch(/\u2014/);
    const file = JSON.parse(gh.fileAt(pr.head.ref, 'figma-fixes.json')!);
    expect(file.fixes.map((f: { id: string }) => f.id)).toEqual(['textinput-label-height', 'textinput-field-height']);
    expect(gh.fileAt('main', 'figma-fixes.json')).toBeUndefined();
  });

  it('opens a layout fix the values referee calls same: Check fidelity decides', async () => {
    const { rw, gh } = setup();
    const r = await figmaFixes.proposeFigmaFixesOp(await rw(), { component: 'TextInput', fixes: [{ ...labelFixed, height: 'hug' }], summary: SUMMARY });
    expect(r).toMatchObject({ status: 'pr-opened', verdict: 'same' });
    expect(gh.pulls[0]!.body).toContain("The values referee can't judge layout, so it says same: Check fidelity decides.");
    // A layout fix that goes the wrong way is still refused.
    const worse = await figmaFixes.proposeFigmaFixesOp(await rw(), { component: 'TextInput', fixes: [{ ...labelFixed, height: 8 }], summary: SUMMARY });
    expect(worse).toMatchObject({ status: 'blocked', verdict: 'worse' });
  });

  it('keeps the repo\'s fixes and refuses fixes that move nothing or go the wrong way', async () => {
    const existing = { version: 1, fixes: [{ id: 'toggle-pill', kind: 'part', component: 'Toggle', part: '.cds--toggle__switch', set: { cornerRadius: 'full' }, reason: 'Carbon toggles are pills in every size.' }] };
    const { rw, gh } = setup({ 'figma-fixes.json': JSON.stringify(existing) });
    const square = { id: 'textinput-label-square', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', set: { cornerRadius: 0 }, reason: 'The label row has square corners.', by: 'claude' };
    const nothing = await figmaFixes.proposeFigmaFixesOp(await rw(), { component: 'TextInput', fixes: [square], summary: SUMMARY });
    expect(nothing).toMatchObject({ status: 'blocked', verdict: 'same' });
    const worse = await figmaFixes.proposeFigmaFixesOp(await rw(), { component: 'TextInput', fixes: [{ ...labelFixed, height: 8 }], summary: SUMMARY });
    expect(worse).toMatchObject({ status: 'blocked', verdict: 'worse' });
    expect(gh.pulls).toHaveLength(0);
    // A status fix is the honest way out: it opens.
    const status = { id: 'textinput-differs', kind: 'status', component: 'TextInput', status: 'differs', reason: 'The label row height comes from a line height Figma does not draw.', by: 'claude' };
    const r = await figmaFixes.proposeFigmaFixesOp(await rw(), { component: 'TextInput', fixes: [status], summary: 'TextInput keeps an honest Differs status.' });
    expect(r.status).toBe('pr-opened');
    const file = JSON.parse(gh.fileAt(gh.pulls[0]!.head.ref, 'figma-fixes.json')!);
    expect(file.fixes.map((f: { id: string }) => f.id)).toEqual(['toggle-pill', 'textinput-differs']);
    // A fix that would take another component's id is refused.
    await expect(figmaFixes.proposeFigmaFixesOp(await rw(), { component: 'TextInput', fixes: [{ ...labelFixed, id: 'toggle-pill' }], summary: SUMMARY })).rejects.toThrow(/taken by a fix for Toggle/);
  });

  it('local repo: a new local bridge/* branch, working tree untouched, never pushed', async () => {
    const root = tempGitRepo(REPO, ['bridge.config.json']);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, 'measured-specs.json'), MEASURED);
    writeFileSync(join(root, 'figma-fidelity.json'), RUN);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'measure');
    const ctx = await BridgeContext.create({ root });
    const dry = await figmaFixes.proposeFigmaFixesOp(ctx, { component: 'TextInput', fixes: [labelFixed], summary: SUMMARY, dryRun: true });
    expect(dry).toMatchObject({ status: 'dry-run', labels: expect.arrayContaining(['drafted-by-claude']) });
    const r = await figmaFixes.proposeFigmaFixesOp(ctx, { component: 'TextInput', fixes: [labelFixed], summary: SUMMARY });
    expect(r).toMatchObject({ status: 'branch-created', branch: 'bridge/figma-fixes-text-input' });
    expect(git(root, 'show', 'bridge/figma-fixes-text-input:figma-fixes.json')).toContain('textinput-label-height');
    expect(git(root, 'status', '--porcelain')).toBe('');
  });
});

describe('over the protocol', () => {
  it('the four tools are registered, read-only where they only read, and take fixes as objects', async () => {
    const { rw, gh } = setup();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer(await rw()).connect(a);
    const client = new Client({ name: 'fix-test', version: '0.0.0' });
    await client.connect(b);
    const { tools } = await client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(by.bridge_figma_gaps!.annotations?.readOnlyHint).toBe(true);
    expect(by.bridge_get_gap_case!.annotations?.readOnlyHint).toBe(true);
    expect(by.bridge_try_figma_fix!.annotations?.readOnlyHint).toBe(true);
    expect(by.bridge_propose_figma_fixes!.annotations?.readOnlyHint).toBe(false);
    expect(by.bridge_try_figma_fix!.description).toMatch(/at most 3 rounds per component/);
    const res = (await client.callTool({ name: 'bridge_try_figma_fix', arguments: { component: 'TextInput', fixes: [labelFixed], fidelity: JSON.parse(RUN) } })) as { content: { text: string }[]; isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0]!.text)).toMatchObject({ verdict: 'closer', report: 'the report passed in' });
    await client.close();
    expect(gh.pulls).toHaveLength(0);
  });
});
