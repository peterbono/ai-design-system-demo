// Push like Figma's library publishing: a Changes list grouped Variables / Components, a checkbox per item, an
// "Experimental" mark that unchecks an item by default, and one "Push for review" that sends only what is checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type RawComponent, buildSignature, classifyComponents, fnv1a } from '../src/sync/components';
import { analyze, buildPull, buildPush } from '../src/sync/flows';
import {
  applyDestination,
  componentDrafts,
  componentKey,
  defaultUnchecked,
  experimentalTokenIds,
  groupState,
  heldTokenIds,
  publish,
  publishItems,
  publishPlan,
  setGroup,
  variableKey,
} from '../src/sync/publish';
import { setExperimental, scanComponents } from '../src/main/components';
import { explorationTestBuild, explorationTryIt, newExplorationProblems, runningExplorations, shareMessage, startExploration, targetOf, TestBuildPoller, tryItLinks } from '../src/sync/explorations';
import { type BridgeConfig, type ExplorationTestBuild, previewComment } from '@bridge-ds/core';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { applyPullPlan } from '../src/main/apply';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { applyPlanToSnapshot, findIn } from './figma-sim';
import { realChecksText, realConfigText, realFiles } from './helpers';

const PREFIX = DEFAULT_SETTINGS.tokensPath;

function repoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${PREFIX}/${rel}`] = text;
  out[`${PREFIX}/contrast.checks.json`] = realChecksText();
  out['bridge.config.json'] = realConfigText();
  out['packages/react/src/components/Button/Button.tsx'] = '';
  out['packages/react/src/components/Card/Card.tsx'] = '';
  return out;
}

/** A pulled file with two variable edits: a radius (primitive) and a space step. */
async function edited() {
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const first = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const pull = buildPull(first, new Map());
  const snapshot = applyPlanToSnapshot(pull.plan, 'single');
  findIn(snapshot, 'Primitives', 'radius/sm').valuesByMode['Primitives:value'] = { kind: 'float', value: 5 };
  findIn(snapshot, 'Primitives', 'space/3').valuesByMode['Primitives:value'] = { kind: 'float', value: 13 };
  return { gh, client, snapshot, sync: { baseSha: pull.plan.headSha } };
}

function component(name: string, nodeId: string, fill: string): RawComponent {
  return {
    nodeId,
    name,
    definitions: [{ name: 'Size', type: 'VARIANT', default: 'md', options: ['md'] }],
    variants: [{ props: { Size: 'md' }, bindings: [{ kind: 'fill', variable: fill, value: '1,1,1,255' }], render: fnv1a(`${name} ${fill}`), structure: fnv1a(name) }],
  };
}

/** Button rebound to another fill (a token-binding change), Card the same, Card marked experimental. */
function componentScan() {
  return classifyComponents(
    [
      { nodeId: '1:1', name: 'Button', signature: buildSignature(component('Button', '1:1', 'button/primary/bg-hover')), baseline: buildSignature(component('Button', '1:1', 'button/primary/bg')) },
      { nodeId: '2:1', name: 'Card', signature: buildSignature(component('Card', '2:1', 'color/bg/subtle')), baseline: buildSignature(component('Card', '2:1', 'card/bg')), experimental: true },
    ],
    ['Button', 'Card'],
  );
}

test('every push starts with all items checked except experimental ones; groups select all', async () => {
  const { client, snapshot, sync } = await edited();
  findIn(snapshot, 'Primitives', 'space/3').experimental = true;
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const experimental = experimentalTokenIds(a, snapshot);
  assert.deepEqual([...experimental], ['path:space.3']);
  const scan = componentScan();
  assert.deepEqual(scan.changed.map((c) => `${c.component}:${c.kind}:${!!c.experimental}`), ['Button:token-binding:false', 'Card:token-binding:true']);
  const items = publishItems(a, experimental, scan.changed);
  assert.deepEqual(items.map((i) => `${i.kind} ${i.label}${i.experimental ? ' (experimental)' : ''}`), [
    'variable radius.sm',
    'variable space.3 (experimental)',
    'component Button',
    'component Card (experimental)',
  ]);
  const unchecked = defaultUnchecked(items);
  assert.deepEqual([...unchecked].sort(), [componentKey('2:1'), variableKey('path:space.3')]);
  assert.equal(groupState(items, unchecked, 'variable'), 'some');
  setGroup(items, unchecked, 'variable', true);
  assert.equal(groupState(items, unchecked, 'variable'), 'all', 'an experimental item can still be checked');
  setGroup(items, unchecked, 'component', false);
  assert.equal(groupState(items, unchecked, 'component'), 'none');
  assert.equal(groupState([], unchecked, 'component'), 'empty');
});

test('unchecked variable edits stay in Figma: only checked ones reach the pull request, with the description first', async () => {
  const { gh, client, snapshot, sync } = await edited();
  findIn(snapshot, 'Primitives', 'space/3').experimental = true;
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const items = publishItems(a, experimentalTokenIds(a, snapshot), []);
  const unchecked = defaultUnchecked(items);
  const held = heldTokenIds(items, unchecked);
  const proposal = buildPush(a, new Map(), new Set(), held);
  assert.deepEqual(proposal.changes.map((c) => c.target!.path), ['radius.sm']);
  assert.deepEqual(proposal.held.map((e) => e.path), ['space.3']);
  assert.deepEqual(Object.keys(proposal.files), ['primitives/radius.tokens.json']);
  const description = 'Softer small radius for chips, agreed in the design crit.';
  const res = await publish(client, { analysis: a, proposal, components: [], unchecked, description, title: '', fileName: 'Test', coded: [], now: new Date(Date.UTC(2026, 9, 17, 9)) });
  assert.equal(gh.prs.length, 1);
  assert.equal(res.requests.length, 0);
  const body = gh.prs[0]!.body;
  assert.ok(body.startsWith(`## What changed and why\n\n${description}\n`), 'the description opens the pull request');
  assert.match(body, /`radius\.sm`/);
  assert.doesNotMatch(body, /space\.3/, 'the unchecked edit is not in the pull request');
  const commit = gh.commits.get(res.pr!.commitSha)!;
  assert.equal(commit.files[`${PREFIX}/primitives/space.tokens.json`], gh.filesAt('main')[`${PREFIX}/primitives/space.tokens.json`]);
  // Still a Figma edit: the next scan lists it again.
  const again = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  assert.ok(again.diff.local.some((e) => e.path === 'space.3'));
});

test('checked component changes become one request each, with the description as summary; unchecked ones are not sent', async () => {
  const { gh, client, snapshot, sync } = await edited();
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const scan = componentScan();
  const items = publishItems(a, new Set(), scan.changed);
  const unchecked = defaultUnchecked(items);
  // Variables unchecked by the designer: no pull request at all, only requests.
  setGroup(items, unchecked, 'variable', false);
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  assert.deepEqual(publishPlan({ proposal, components: scan.changed, unchecked, description: '', fileName: 'Test' }).prFiles, 0);
  const drafts = componentDrafts(scan.changed, unchecked, '', 'Library.fig');
  assert.deepEqual(drafts.map((d) => [d.component, d.summary]), [['Button', 'Changed in Figma ("Library.fig") and sent for review with Bridge.']]);
  const res = await publish(client, {
    analysis: a,
    proposal,
    components: scan.changed,
    unchecked,
    description: 'Hover should use the hover token.',
    title: '',
    fileName: 'Library.fig',
    coded: ['Button', 'Card'],
    image: async (nodeId) => (nodeId === '1:1' ? 'iVBORw0KGgo=' : undefined),
  });
  assert.equal(res.pr, undefined);
  assert.equal(gh.prs.length, 0);
  assert.deepEqual(res.requests.map((x) => [x.component, x.nodeId]), [['Button', '1:1']]);
  assert.equal(gh.issues.length, 1, 'the experimental Card change is not sent');
  assert.match(gh.issues[0]!.title, /^Button: /);
  assert.match(gh.issues[0]!.body, /Hover should use the hover token\./);
  assert.match(gh.issues[0]!.body, /!\[Button design 1\]/, 'the component image is attached');
});

test('nothing checked: Push for review refuses to send', async () => {
  const { client, snapshot, sync } = await edited();
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const items = publishItems(a, new Set(), []);
  const unchecked = new Set(items.map((i) => i.key));
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  await assert.rejects(publish(client, { analysis: a, proposal, components: [], unchecked, description: '', title: '', fileName: 'Test', coded: [] }), /Nothing is checked/);
});

test('the experimental mark is durable shared plugin data on the variable and the component set (a variant marks its set)', async () => {
  const sim = new SimFigma().install();
  const gh = new FakeGitHub(repoFiles());
  const a = await analyze(gh.client(), DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const v = sim.variables.find((x) => x.name === 'radius/sm')!;
  const f = (globalThis as unknown as { figma: { createComponent(): never; combineAsVariants(n: unknown[], p: unknown): { id: string; name: string } } }).figma;
  const c1 = f.createComponent() as unknown as { id: string; name: string };
  c1.name = 'Size=md';
  sim.currentPage.appendChild(c1 as never);
  const set = f.combineAsVariants([c1], sim.currentPage);
  set.name = 'Button';
  assert.equal(await setExperimental([{ kind: 'variable', id: v.id }, { kind: 'component', id: c1.id }], true), 2);
  assert.equal(v.getSharedPluginData('dsbridge', 'experimental'), 'true');
  const snap = await takeSnapshot();
  assert.equal(snap.variables.find((x) => x.id === v.id)!.experimental, true);
  assert.equal(snap.variables.filter((x) => x.experimental).length, 1);
  const scanned = await scanComponents(() => {});
  assert.equal(scanned.components.find((x) => x.nodeId === set.id)!.experimental, true, 'the variant marked its set');
  await setExperimental([{ kind: 'component', id: set.id }], false);
  assert.equal((await scanComponents(() => {})).components.find((x) => x.nodeId === set.id)!.experimental, undefined);
});

test('a component change an optional part already covers starts unchecked, with its hint; checking it sends it anyway', async () => {
  const { gh, client, snapshot, sync } = await edited();
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const label = { name: 'Label', type: 'TEXT', visible: true, part: 'text' };
  const iconEnd = { name: 'Icon end', type: 'INSTANCE', main: 'Icon/Plus', visible: false, part: 'icon-end', visibleProp: 'Icon end' };
  const raw = (added: boolean): RawComponent => ({
    nodeId: '1:1',
    name: 'Button',
    definitions: [{ name: 'Size', type: 'VARIANT', default: 'md', options: ['md'] }],
    variants: [
      {
        props: { Size: 'md' },
        bindings: [],
        render: added ? 'r2' : 'r1',
        layers: added ? [label, { name: 'Icon', type: 'INSTANCE', main: 'Icon/Pencil', visible: true }, iconEnd] : [label, iconEnd],
      },
    ],
  });
  const scan = classifyComponents([{ nodeId: '1:1', name: 'Button', signature: buildSignature(raw(true)), baseline: buildSignature(raw(false)) }], ['Button']);
  const items = publishItems(a, new Set(), scan.changed);
  const button = items.find((i) => i.kind === 'component')!;
  assert.equal(button.hint, 'Icon end already does this: show it with the Icon end property');
  const unchecked = defaultUnchecked(items);
  assert.ok(unchecked.has(componentKey('1:1')), 'starts unchecked');
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  assert.equal(publishPlan({ proposal, components: scan.changed, unchecked, description: '', fileName: 'Test' }).drafts.length, 0);
  // "Keep it as a request": checked, it becomes a structure request.
  unchecked.delete(componentKey('1:1'));
  const res = await publish(client, { analysis: a, proposal, components: scan.changed, unchecked, description: '', descriptionIsDraft: true, title: '', fileName: 'Test', coded: ['Button'] });
  assert.equal(res.requests.length, 1);
  assert.deepEqual(gh.issues[0]!.labels.slice(0, 2), ['component-change', 'request: structure']);
  assert.equal(gh.issues[0]!.title, 'Button: add a layer after Label');
});

test("Claude's request title per component names the issue; components without one keep the drafted title", async () => {
  const { gh, client, snapshot, sync } = await edited();
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const scan = componentScan();
  const items = publishItems(a, new Set(), scan.changed);
  const unchecked = new Set(items.filter((i) => i.kind === 'variable').map((i) => i.key));
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  await publish(client, { analysis: a, proposal, components: scan.changed, unchecked, description: '', descriptionIsDraft: true, title: '', fileName: 'Test', coded: ['Button', 'Card'], titles: new Map([['1:1', 'Use the hover fill for primary buttons']]) });
  assert.deepEqual(gh.issues.map((i) => i.title), ['Button: use the hover fill for primary buttons', 'Card: use color.bg.subtle for the fill']);
});

// ---------------------------------------------------------------------------------------------
// Push to an exploration

test('explorations: start one from Push, list the running ones with previews and the snapshot install', async () => {
  const { gh, client } = await edited();
  assert.deepEqual(await runningExplorations(client, undefined, 'main'), []);
  assert.deepEqual(newExplorationProblems('', ''), ['Name the exploration, for example "Denser data tables".', 'Say what you want to learn, in one sentence.']);
  const config = { previews: { packages: ['@bridge-ds/tokens', '@bridge-ds/react'], apps: { docs: 'https://docs-git-{branch}.example.app' } } } as unknown as Parameters<typeof startExploration>[1];
  const started = await startExploration(client, config, 'main', { name: 'Pill buttons', purpose: 'Do rounder buttons feel friendlier?' });
  assert.equal(started.branch, 'explore/pill-buttons');
  assert.equal(gh.prs.length, 1);
  assert.deepEqual(gh.prs[0]!.labels, ['exploration']);
  assert.equal(gh.prs[0]!.draft, true);
  assert.ok(gh.filesAt('explore/pill-buttons')['.bridge/explorations/pill-buttons.md']);
  const list = await runningExplorations(client, config, 'main');
  assert.deepEqual(list.map((e) => `${e.name} ${e.branch} #${e.number}`), ['Pill buttons explore/pill-buttons #1']);
  // No guessed install command on the choice: it comes from the pull request's preview comment (explorationTryIt).
  assert.equal('install' in list[0]!, false);
  assert.deepEqual(list[0]!.previews.map((p) => p.url), ['https://docs-git-explore-pill-buttons.example.app/']);
});

test('push to an exploration: variable edits commit to explore/<slug>, no pull request to main, requests labeled exploration', async () => {
  const { gh, client, snapshot, sync } = await edited();
  const exploration = await startExploration(client, undefined, 'main', { name: 'Rounder corners', purpose: 'Try softer radii.' });
  // Someone already tried another edit on the exploration: it must stay.
  const radiusFile = `${PREFIX}/primitives/radius.tokens.json`;
  const branchFiles = gh.filesAt('explore/rounder-corners');
  const doc = JSON.parse(branchFiles[radiusFile]!);
  doc.radius.lg.$value.value = 14;
  const earlier = gh.commit({ ...branchFiles, [radiusFile]: `${JSON.stringify(doc, null, 2)}\n` }, [gh.branches.get('explore/rounder-corners')!], 'earlier');
  gh.branches.set('explore/rounder-corners', earlier);
  const mainBefore = gh.branches.get('main');
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const scan = componentScan();
  const items = publishItems(a, new Set(), scan.changed);
  const unchecked = defaultUnchecked(items, 'exploration');
  assert.equal(unchecked.size, 0, 'experimental Card starts checked for an exploration');
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  const res = await publish(client, { analysis: a, proposal, components: scan.changed, unchecked, description: 'Softer radii for the checkout test.', title: '', fileName: 'Test', coded: ['Button', 'Card'], exploration: targetOf(exploration) });
  assert.equal(gh.branches.get('main'), mainBefore, 'main untouched');
  assert.equal(gh.prs.length, 1, 'no new pull request: the exploration draft is the place');
  assert.equal(res.exploration?.branch, 'explore/rounder-corners');
  assert.equal(res.exploration?.unchanged, false);
  const radius = JSON.parse(gh.filesAt('explore/rounder-corners')[radiusFile]!).radius;
  assert.equal(radius.sm.$value.value, 5, 'the Figma edit is on the exploration');
  assert.equal(radius.lg.$value.value, 14, 'the earlier exploration commit is kept');
  assert.equal(JSON.parse(gh.filesAt('main')[radiusFile]!).radius.sm.$value.value, 4);
  assert.ok(gh.comments.some((c) => c.number === exploration.number && /added a commit from Figma to this exploration/.test(c.body)));
  assert.equal(res.requests.length, 2);
  for (const issue of gh.issues) {
    assert.ok(issue.labels.includes('exploration'), issue.title);
    assert.match(issue.body, /\*\*Exploration:\*\* `explore\/rounder-corners`/);
  }
  // Sending the same edits again commits nothing.
  const again = await publish(client, { analysis: a, proposal, components: [], unchecked, description: '', title: '', fileName: 'Test', coded: [], exploration: targetOf(exploration) });
  assert.equal(again.exploration?.unchanged, true);
  // Only component requests: no variable edit was sent, so the result never says the exploration "already had" them.
  const onlyComponents = await publish(client, { analysis: a, proposal: { ...proposal, files: {}, brandFiles: [] }, components: scan.changed, unchecked: new Set(), description: '', title: '', fileName: 'Test', coded: ['Button', 'Card'], exploration: targetOf(exploration) });
  assert.equal(onlyComponents.exploration?.unchanged, false);
});

// The result screen's "Try it": previews in a designer's order, the test build from the preview comment, the share message.
const tarballs = (sha: string) => ['tokens', 'core', 'react'].map((p) => ({ name: `@bridge-ds/${p}`, url: `https://github.com/o/r/releases/download/preview-pr-1/bridge-ds-${p}-${sha.slice(0, 7)}.tgz` }));
const stickyComment = (gh: FakeGitHub, number: number, branch: string, sha: string, source: 'release' | 'pkg.pr.new' | 'none') =>
  gh.comments.push({
    number,
    body: previewComment({
      owner: 'o', repo: 'r', pr: number, branch, sha, source, apps: {}, exploration: true,
      packages: source === 'release' ? tarballs(sha) : source === 'pkg.pr.new' ? [{ name: '@bridge-ds/react', url: `https://pkg.pr.new/o/r/@bridge-ds/react@${sha}` }] : [],
    }),
  });

test('try it: building until the preview comment matches the latest commit, then the command the workflow published', async () => {
  const { gh, client, snapshot, sync } = await edited();
  const e = await startExploration(client, undefined, 'main', { name: 'Pill buttons', purpose: 'Rounder buttons.' });
  // Snapshot still building: no comment yet. Never a guessed pkg.pr.new command.
  assert.deepEqual(await explorationTryIt(client, e), { state: 'building' });
  stickyComment(gh, e.number, e.branch, gh.branches.get(e.branch)!, 'release');
  const ready = await explorationTryIt(client, e);
  assert.equal(ready.state, 'ready');
  assert.match(ready.state === 'ready' ? ready.command : '', /^npm i @bridge-ds\/tokens@https:\/\/github\.com\/o\/r\/releases\/download\/preview-pr-1\/bridge-ds-tokens-c\w{6}\.tgz /);
  assert.doesNotMatch(ready.state === 'ready' ? ready.command : '', /pkg\.pr\.new/);
  // A push from Figma: the comment is about the previous commit until the workflow runs again.
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const items = publishItems(a, new Set(), []);
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, new Set()));
  await publish(client, { analysis: a, proposal, components: [], unchecked: new Set(), description: '', title: '', fileName: 'Test', coded: [], exploration: targetOf(e) });
  assert.deepEqual(await explorationTryIt(client, e), { state: 'building' });
  // pkg.pr.new only when the comment says so.
  stickyComment(gh, e.number, e.branch, gh.branches.get(e.branch)!, 'pkg.pr.new');
  const pkg = await explorationTryIt(client, e);
  assert.equal(pkg.state === 'ready' && pkg.source, 'pkg.pr.new');
  // The publish step failed: the comment has no command.
  stickyComment(gh, e.number, e.branch, gh.branches.get(e.branch)!, 'none');
  assert.deepEqual(await explorationTryIt(client, e), { state: 'failed' });
});

test('try it: the product first, then Library and Workbench; one share message for a developer', () => {
  const e = {
    name: 'Pill buttons',
    branch: 'explore/pill-buttons',
    url: 'https://github.com/o/r/pull/7',
    previews: [
      { app: 'docs', label: 'Docs', url: 'https://docs.example/' },
      { app: 'storybook', label: 'Storybook', url: 'https://sb.example/' },
      { app: 'admin', label: 'Admin demo', url: 'https://admin.example/' },
    ],
  };
  assert.deepEqual(tryItLinks(e).map((l) => l.label), ['Admin demo', 'Library', 'Workbench']);
  const ready = shareMessage(e, { state: 'ready', command: 'npm i @bridge-ds/react@https://x/react.tgz', source: 'release', sha7: 'abcdef0' });
  assert.equal(
    ready,
    'Exploration "Pill buttons" (explore/pill-buttons): try it in a staging branch of your product with: npm i @bridge-ds/react@https://x/react.tgz. Previews: Admin demo https://admin.example/, Library https://docs.example/, Workbench https://sb.example/. Pull request: https://github.com/o/r/pull/7.',
  );
  const building = shareMessage(e, { state: 'building' });
  assert.match(building, /being prepared/);
  assert.doesNotMatch(building, /npm i|pkg\.pr\.new/);
  assert.doesNotMatch(ready + building, /\u2014/);
});

// PR #64's real shape: Vercel shortened the admin and storybook aliases of explore/button-normal-again with a hash.
const REAL_ADMIN = 'bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app';
const REAL_STORYBOOK = 'bridge-storybook-git-explore-button-8a43de-peterbonos-projects.vercel.app';
const vercelComment = (admin: string | null, status = 'DEPLOYED') =>
  `[vc]: #h:${Buffer.from(JSON.stringify({ projects: [{ name: 'bridge-storybook', previewUrl: REAL_STORYBOOK, nextCommitStatus: status }, ...(admin ? [{ name: 'bridge-admin', previewUrl: admin, nextCommitStatus: status }] : [])] })).toString('base64')}\nThe latest updates on your projects.`;

test('try it: the preview URLs Vercel reports, never the template it shortened; settled when everything is ready', async () => {
  const { gh, client } = await edited();
  const config = JSON.parse(realConfigText()) as BridgeConfig;
  const e = await startExploration(client, config, 'main', { name: 'Button normal again', purpose: 'Back to the regular button.' });
  // Templates: only docs fits in 63 characters. Admin (64) and storybook (68) are never guessed.
  assert.deepEqual(e.previews.map((p) => p.app), ['docs']);
  const before = await explorationTestBuild(client, config, e);
  assert.deepEqual(before.previews.map((p) => [p.app, p.url]), [
    ['docs', 'https://bridge-docs-git-explore-button-normal-again-peterbonos-projects.vercel.app/'],
    ['storybook', null],
    ['admin', null],
  ]);
  assert.equal(before.settled, false);
  assert.deepEqual(tryItLinks(e, before.previews).map((l) => [l.label, l.url]), [
    ['Admin demo', null],
    ['Library', 'https://bridge-docs-git-explore-button-normal-again-peterbonos-projects.vercel.app/'],
    ['Workbench', null],
  ]);
  // Vercel comments, builds, then reports success; the workflow posts the command.
  gh.comments.push({ number: e.number, body: vercelComment(REAL_ADMIN, 'BUILDING') });
  const head = gh.branches.get(e.branch)!;
  gh.statuses.set(head, ['admin', 'storybook', 'docs'].map((app) => ({ context: `Vercel – bridge-${app}`, state: 'pending', target_url: `https://vercel.com/peterbonos-projects/bridge-${app}/x`, description: null })));
  const building = await explorationTestBuild(client, config, e);
  assert.deepEqual(building.previews.map((p) => [p.url, p.state]), [
    ['https://bridge-docs-git-explore-button-normal-again-peterbonos-projects.vercel.app/', 'building'],
    [`https://${REAL_STORYBOOK}/`, 'building'],
    [`https://${REAL_ADMIN}/`, 'building'],
  ]);
  assert.equal(building.settled, false);
  gh.statuses.set(head, ['admin', 'storybook', 'docs'].map((app) => ({ context: `Vercel – bridge-${app}`, state: 'success', target_url: `https://vercel.com/peterbonos-projects/bridge-${app}/x`, description: null })));
  stickyComment(gh, e.number, e.branch, head, 'release');
  const ready = await explorationTestBuild(client, config, e);
  assert.equal(ready.tryIt.state, 'ready');
  assert.equal(ready.settled, true);
  const msg = shareMessage(e, ready.tryIt, ready.previews);
  assert.match(msg, new RegExp(`Admin demo https://${REAL_ADMIN.replace(/\./g, '\\.')}/`));
  assert.doesNotMatch(msg, /bridge-admin-git-explore-button-normal-again|pkg\.pr\.new/);
});

test('try it: polls every 15 seconds while the screen is open, stops when settled, gives up after 10 minutes', async () => {
  let now = 0;
  const timers: { fn: () => void; at: number }[] = [];
  const clock = {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, at: now + ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h: unknown) => {
      const i = timers.indexOf(h as never);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
      await new Promise((r) => setImmediate(r));
    }
  };
  const build = (settled: boolean): ExplorationTestBuild => ({ tryIt: settled ? { state: 'ready', command: 'npm i x', source: 'release', sha7: null } : { state: 'building' }, previews: [], settled });
  let reads = 0;
  let settleAt = 3;
  let open = true;
  const updates: boolean[] = [];
  let timedOut = 0;
  const p = new TestBuildPoller({ ...clock, isOpen: () => open, read: async () => build(++reads >= settleAt), onUpdate: (t) => updates.push(t.settled), onTimeout: () => timedOut++ });
  p.start();
  await advance(14_999);
  assert.equal(reads, 0, 'nothing before 15 seconds');
  await advance(1);
  assert.equal(reads, 1);
  // Screen closed: the tick reads nothing.
  open = false;
  await advance(15_000);
  assert.equal(reads, 1);
  open = true;
  await advance(15_000);
  await advance(15_000);
  assert.equal(reads, 3);
  assert.deepEqual(updates, [false, false, true]);
  assert.equal(p.active, false, 'settled: polling stopped');
  await advance(60_000);
  assert.equal(reads, 3);

  // Never settles: stops after 10 minutes (40 reads at most), "Check again" starts it over.
  reads = 0;
  settleAt = Infinity;
  p.start();
  for (let i = 0; i < 45; i++) await advance(15_000);
  assert.equal(timedOut, 1);
  assert.equal(p.active, false);
  assert.ok(reads <= 40, `${reads} reads in 10 minutes`);
  p.start();
  assert.equal(await p.check(), false);
  assert.equal(p.active, true);
  p.stop();
});

test('destination: experimental items start checked for an exploration and unchecked for review', () => {
  const items = [
    { key: 'v:a', kind: 'variable' as const, id: 'a', label: 'a', experimental: true },
    { key: 'v:b', kind: 'variable' as const, id: 'b', label: 'b', experimental: false },
    { key: 'c:1', kind: 'component' as const, id: '1', label: 'Button', experimental: false, suggestSkip: true },
  ];
  assert.deepEqual([...defaultUnchecked(items)].sort(), ['c:1', 'v:a']);
  assert.deepEqual([...defaultUnchecked(items, 'exploration')], ['c:1']);
  const unchecked = defaultUnchecked(items);
  unchecked.delete('c:1');
  applyDestination(items, unchecked, 'exploration');
  assert.deepEqual([...unchecked], [], 'only experimental items follow the destination; the designer\'s own choice stays');
  applyDestination(items, unchecked, 'review');
  assert.deepEqual([...unchecked], ['v:a']);
});
