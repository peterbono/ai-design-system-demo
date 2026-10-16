// End-to-end: GitHub (fake) -> pull -> Figma (simulated) -> edits -> push -> PR, without Figma.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, buildPull, buildPush, openPullRequest } from '../src/core/flows';
import type { RenameSuggestion } from '../src/core/id-map';
import { DEFAULT_SETTINGS, type FigmaSnapshot } from '../src/shared/messages';
import { FakeGitHub } from './fake-github';
import { applyPlanToSnapshot, findVar, primId } from './figma-sim';
import { realFiles, realPairsText } from './helpers';

const PREFIX = DEFAULT_SETTINGS.tokensPath;

function repoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${PREFIX}/${rel}`] = text;
  out[`${PREFIX}/contrast-pairs.json`] = realPairsText();
  return out;
}

async function pulled(layout: 'single' | 'split' = 'single') {
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const pull = buildPull(a, new Map());
  const snapshot = applyPlanToSnapshot(pull.plan, layout);
  return { gh, client, snapshot, sync: { baseSha: pull.plan.headSha }, firstAnalysis: a, pull };
}

test('first pull creates every Figma-compatible token and skips composites', async () => {
  const { pull, firstAnalysis, snapshot } = await pulled();
  assert.equal(firstAnalysis.diff.conflicts.length, 0);
  const total = firstAnalysis.head.tokens.size;
  const codeOnly = firstAnalysis.codeOnly.map((u) => u.path).sort();
  assert.deepEqual(codeOnly, ['elevation.overlay', 'elevation.raised', 'shadow.md', 'shadow.md-strong', 'shadow.sm', 'shadow.sm-strong']);
  assert.equal(pull.plan.variables.length, total - codeOnly.length);
  const bg = findVar(snapshot, 'color/action/primary/bg');
  assert.deepEqual(bg.scopes, ['FRAME_FILL', 'SHAPE_FILL']);
  assert.equal(Object.values(bg.valuesByMode).every((v) => v.kind === 'alias'), true);
  assert.deepEqual(findVar(snapshot, 'color/neutral/0').scopes, []);
  assert.equal(findVar(snapshot, 'font/family/sans').valuesByMode['Primitives:value']?.kind, 'string');
});

for (const layout of ['single', 'split'] as const) {
  test(`round trip through Figma is lossless (${layout} layout): no changes, no files`, async () => {
    const { client, snapshot, sync } = await pulled(layout);
    const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
    assert.equal(a.figma.layout, layout === 'single' ? 'single-collection' : 'split-collections');
    assert.deepEqual([a.diff.local.length, a.diff.remote.length, a.diff.conflicts.length], [0, 0, 0]);
    const push = buildPush(a, new Map());
    assert.deepEqual(push.files, {});
  });
}

test('push: edits in Figma become a minimal PR with only the changed files', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  // 1. Re-point a semantic token (light) to another primitive.
  const bg = findVar(snapshot, 'color/action/primary/bg');
  const light = snapshot.collections.find((c) => c.name === 'Semantic')!.modes.find((m) => m.name === 'Light')!.modeId;
  bg.valuesByMode[light] = { kind: 'alias', id: primId(snapshot, 'color/brand/700') };
  // 2. Change a primitive value (float32 noise included) and its description.
  const n50 = findVar(snapshot, 'color/neutral/50');
  n50.valuesByMode['Primitives:value'] = { kind: 'color', r: Math.fround(0.96), g: Math.fround(0.97), b: Math.fround(0.98), a: 1 };
  n50.description = 'Subtle background';
  // 3. Rename a variable (keeps its plugin data id).
  findVar(snapshot, 'radius/lg').name = 'radius/xl';
  // 4. New variable created in Figma (no plugin data).
  snapshot.variables.push({
    id: 'new1',
    name: 'space/16',
    collectionId: 'c:Primitives',
    resolvedType: 'FLOAT',
    description: '',
    scopes: ['GAP', 'WIDTH_HEIGHT'],
    valuesByMode: { 'Primitives:value': { kind: 'float', value: 64 } },
    pluginData: {},
  });

  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const kinds = Object.fromEntries(a.diff.local.map((e) => [e.path, e.local!.kind]));
  assert.deepEqual(kinds, { 'color.action.primary.bg': 'changed', 'color.neutral.50': 'changed', 'radius.xl': 'renamed', 'space.16': 'added' });

  const push = buildPush(a, new Map());
  assert.deepEqual(push.validation.blocking, []);
  assert.deepEqual(Object.keys(push.files).sort(), [
    'primitives/color.tokens.json',
    'primitives/radius.tokens.json',
    'primitives/space.tokens.json',
    'semantic/light.tokens.json',
  ]);
  const original = realFiles();
  // Lines that differ at the same position (files keep their line count except for additions).
  const changedLines = (file: string) => {
    const before = original[file]!.split('\n');
    return push.files[file]!.split('\n').filter((l, i) => l !== before[i]);
  };
  assert.deepEqual(changedLines('semantic/light.tokens.json'), ['          "$value": "{color.brand.700}"']);
  assert.deepEqual(changedLines('primitives/space.tokens.json'), [
    '    "12": { "$value": { "value": 48, "unit": "px" } },',
    '    "16": { "$value": { "value": 64, "unit": "px" } }',
    '  }',
    '}',
    '',
  ]);
  assert.match(push.files['primitives/radius.tokens.json']!, /"xl": \{ "\$value": \{ "value": 10, "unit": "px" \}, "\$extensions": \{ "com\.dsbridge\.id": "path:radius\.lg" \} \}/);
  assert.match(push.files['primitives/color.tokens.json']!, /"\$description": "Subtle background",\n\s+"\$value": \{\n\s+"colorSpace": "srgb",\n\s+"components": \[\n\s+0\.96,/);

  const result = await openPullRequest(client, a, push, { title: '', notes: '', fileName: 'Test', now: new Date(Date.UTC(2026, 9, 16, 14, 5)) });
  assert.match(result.branch, /^tokens\/[a-z0-9-]+-20261016-1405$/);
  const pr = gh.prs[0]!;
  assert.equal(pr.draft, true);
  assert.deepEqual(pr.labels, ['tokens']);
  assert.match(pr.body, /Tier 3: token change, needs design \+ tech approval/);
  assert.match(pr.body, /\| `color\.action\.primary\.bg` \| changed \| `color\.brand\.600 \(#[0-9a-f]{6}\)` -> `color\.brand\.700 \(#[0-9a-f]{6}\)` \|/);
  assert.match(pr.body, /Light vs color\.action\.primary\.text: 7\.07 -> \d+\.\d+ AAA/);
  assert.equal(pr.body.includes(String.fromCharCode(0x2014)), false, 'no em dash in the PR body');
  // One commit on top of main holding only the changed files plus a changeset.
  const commit = gh.commits.get(result.commitSha)!;
  assert.deepEqual(commit.parents, [a.headSha]);
  const mainFiles = gh.filesAt('main');
  const changed = Object.keys(commit.files).filter((f) => commit.files[f] !== mainFiles[f]).sort();
  assert.equal(changed.length, 5);
  assert.ok(changed.some((f) => /^\.changeset\/ds-bridge-.*\.md$/.test(f)));
  const changeset = commit.files[changed.find((f) => f.startsWith('.changeset/'))!]!;
  assert.match(changeset, /"@demo-ds\/tokens": major/, 'a rename is a breaking change');
  // Variables learn their ids so the next diff matches by id.
  assert.ok(result.tags.some((t) => t.variableId === 'new1' && t.pluginData.id === 'path:space.16'));
});

test('guardrails block raw values, broken contrast and ALL_SCOPES', async () => {
  const { client, snapshot, sync } = await pulled();
  const sem = snapshot.collections.find((c) => c.name === 'Semantic')!;
  const light = sem.modes.find((m) => m.name === 'Light')!.modeId;
  findVar(snapshot, 'color/text/default').valuesByMode[light] = { kind: 'alias', id: primId(snapshot, 'color/neutral/200') };
  findVar(snapshot, 'color/text/muted').valuesByMode[light] = { kind: 'color', r: 0.3, g: 0.3, b: 0.3, a: 1 };
  findVar(snapshot, 'color/border/default').scopes = ['ALL_SCOPES'];
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const push = buildPush(a, new Map());
  const codes = push.validation.blocking.map((i) => `${i.code}:${i.path}`);
  assert.ok(codes.includes('semantic-raw-value:color.text.muted'), codes.join('\n'));
  assert.ok(codes.includes('contrast:color.text.default on color.bg.default'), codes.join('\n'));
  assert.ok(codes.includes('all-scopes:color.border.default'), codes.join('\n'));
  await assert.rejects(openPullRequest(client, a, push, { title: 't', notes: '', fileName: 'x' }), /blocking/);
});

test('conflicts are surfaced and nothing is overwritten until the user picks', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  gh.pushToMain((files) => {
    const f = `${PREFIX}/semantic/dark.tokens.json`;
    files[f] = files[f]!.replace('"bg": {\n          "$value": "{color.brand.400}"', '"bg": {\n          "$value": "{color.brand.500}"');
  });
  const sem = snapshot.collections.find((c) => c.name === 'Semantic')!;
  const dark = sem.modes.find((m) => m.name === 'Dark')!.modeId;
  findVar(snapshot, 'color/action/primary/bg').valuesByMode[dark] = { kind: 'alias', id: primId(snapshot, 'color/brand/300') };
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  assert.deepEqual(a.diff.conflicts.map((c) => c.path), ['color.action.primary.bg']);

  const unresolved = buildPush(a, new Map());
  assert.equal(unresolved.unresolvedConflicts.length, 1);
  assert.deepEqual(unresolved.files, {});
  await assert.rejects(openPullRequest(client, a, unresolved, { title: 't', notes: '', fileName: 'x' }), /conflict/);

  const keepFigma = buildPush(a, new Map([[a.diff.conflicts[0]!.id, 'figma']]));
  assert.match(keepFigma.files['semantic/dark.tokens.json']!, /"\$value": "\{color\.brand\.300\}"/);

  const pullMain = buildPull(a, new Map([[a.diff.conflicts[0]!.id, 'main']]));
  const planned = pullMain.plan.variables.find((v) => v.path === 'color.action.primary.bg')!;
  assert.deepEqual(planned.values.dark, { kind: 'alias-token', path: 'color.brand.500', tokenId: 'path:color.brand.500' });
  const pullKeep = buildPull(a, new Map());
  assert.equal(pullKeep.plan.variables.some((v) => v.path === 'color.action.primary.bg'), false, 'unresolved conflict is left alone');
});

test('pull keeps local edits and flags tokens removed on main as orphans', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  gh.pushToMain((files) => {
    const f = `${PREFIX}/primitives/radius.tokens.json`;
    files[f] = files[f]!.replace('    "lg": { "$value": { "value": 10, "unit": "px" } },\n', '');
  });
  findVar(snapshot, 'radius/sm').valuesByMode['Primitives:value'] = { kind: 'float', value: 3 };
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const pull = buildPull(a, new Map());
  assert.deepEqual(pull.kept.map((e) => e.path), ['radius.sm']);
  assert.equal(pull.plan.variables.some((v) => v.path === 'radius.sm'), false);
  assert.deepEqual(pull.plan.orphans.map((o) => o.name), ['radius/lg']);
  const after = applyPlanToSnapshot(pull.plan, 'single', snapshot);
  const lg = findVar(after, 'radius/lg');
  assert.equal(lg.pluginData.orphan, true);
  assert.match(lg.description, /^\[orphan\] /);
  // After the pull the orphan is not reported as a Figma-side addition.
  const next = await analyze(client, DEFAULT_SETTINGS, { baseSha: pull.plan.headSha }, after);
  assert.deepEqual(next.diff.local.map((e) => [e.path, e.local!.kind]).sort(), [['radius.lg', 'added'], ['radius.sm', 'changed']]);
});

test('rename without plugin data is only a suggestion until confirmed', async () => {
  const { client, snapshot, sync } = await pulled();
  const v = findVar(snapshot, 'color/text/muted');
  v.name = 'color/text/subtle';
  v.pluginData = {};
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot as FigmaSnapshot);
  assert.deepEqual(a.suggestions.map((s) => [s.fromPath, s.toPath]), [['color.text.muted', 'color.text.subtle']]);
  assert.deepEqual(a.diff.local.map((e) => e.local!.kind).sort(), ['added', 'removed']);
  const confirmed: RenameSuggestion[] = a.suggestions;
  const b = await analyze(client, DEFAULT_SETTINGS, sync, snapshot, confirmed);
  assert.deepEqual(b.diff.local.map((e) => [e.path, e.local!.kind]), [['color.text.subtle', 'renamed']]);
  const push = buildPush(b, new Map());
  for (const file of ['semantic/light.tokens.json', 'semantic/dark.tokens.json']) {
    assert.match(push.files[file]!, /"subtle": \{\n\s+"\$value": "\{color\.neutral\.\d+\}",\n\s+"\$extensions": \{\n\s+"com\.dsbridge\.id": "path:color\.text\.muted"\n\s+\}/);
    assert.doesNotMatch(push.files[file]!, /"muted"/);
  }
});

test('appending to an open PR adds a commit on its branch', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  findVar(snapshot, 'radius/sm').valuesByMode['Primitives:value'] = { kind: 'float', value: 3 };
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const first = await openPullRequest(client, a, buildPush(a, new Map()), { title: 'Radius tweak', notes: '', fileName: 'x' });
  findVar(snapshot, 'radius/md').valuesByMode['Primitives:value'] = { kind: 'float', value: 7 };
  const b = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const second = await openPullRequest(client, b, buildPush(b, new Map()), { title: 'Radius tweak 2', notes: '', fileName: 'x', appendTo: first.pr });
  assert.equal(second.appended, true);
  assert.equal(second.branch, first.branch);
  assert.equal(gh.prs.length, 1);
  assert.deepEqual(gh.commits.get(second.commitSha)!.parents, [first.commitSha]);
  assert.match(gh.filesAt(first.branch)[`${PREFIX}/primitives/radius.tokens.json`]!, /"md": \{ "\$value": \{ "value": 7, "unit": "px" \} \}/);
});
