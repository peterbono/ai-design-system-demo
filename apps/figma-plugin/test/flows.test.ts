// End-to-end: GitHub (fake) -> pull -> Figma (simulated) -> edits -> push -> PR, without Figma.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTokenFile, readTokenAt, removeToken, serializeTokenFile, upsertToken } from '@bridge-ds/core';
import { analyze, buildPull, buildPush, openPullRequest } from '../src/sync/flows';
import type { RenameSuggestion } from '@bridge-ds/core';
import { DEFAULT_SETTINGS, type FigmaSnapshot } from '../src/shared/messages';
import { FakeGitHub } from './fake-github';
import { applyPlanToSnapshot, findIn, modeId } from './figma-sim';
import { realChecksText, realConfigText, realFiles } from './helpers';

const PREFIX = DEFAULT_SETTINGS.tokensPath;

function repoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${PREFIX}/${rel}`] = text;
  out[`${PREFIX}/contrast.checks.json`] = realChecksText();
  out['bridge.config.json'] = realConfigText();
  return out;
}

/** Edit one token value in a repo file map (as someone merging on main would). */
function setValue(files: Record<string, string>, rel: string, path: string, value: unknown) {
  const f = `${PREFIX}/${rel}`;
  const doc = parseTokenFile(f, files[f]!);
  const t = readTokenAt(doc, path)!;
  upsertToken(doc, path, { type: t.type!, value, description: t.description });
  files[f] = serializeTokenFile(doc);
}

async function pulled(layout: 'single' | 'split' = 'single') {
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const pull = buildPull(a, new Map());
  const snapshot = applyPlanToSnapshot(pull.plan, layout);
  return { gh, client, snapshot, sync: { baseSha: pull.plan.headSha }, firstAnalysis: a, pull };
}

/** Point `name` in `collection` (mode `mode`) at the variable `target` of `targetCollection`. */
function alias(snap: FigmaSnapshot, collection: string, name: string, mode: string, targetCollection: string, target: string) {
  findIn(snap, collection, name).valuesByMode[modeId(snap, collection, mode)] = { kind: 'alias', id: findIn(snap, targetCollection, target).id };
}

/** The Changes-table row of `path` in a PR body, split into cells. */
function row(body: string, path: string): string[] {
  const line = body.split('\n').find((l) => l.startsWith(`| \`${path}\` |`));
  assert.ok(line, `no row for ${path} in\n${body}`);
  return line.split(' | ');
}

test('first pull creates one collection per tier with its modes, and skips composites', async () => {
  const { pull, firstAnalysis, snapshot } = await pulled();
  assert.equal(firstAnalysis.diff.conflicts.length, 0);
  assert.deepEqual(
    snapshot.collections.map((c) => `${c.name}: ${c.modes.map((m) => m.name).join(', ')}`),
    ['Primitives: Value', 'Brand: Bridge, Ocean', 'Base: Value', 'Semantic: Light, Dark', 'Density: Comfortable, Compact', 'Component: Value'],
  );
  const total = firstAnalysis.head.tokens.size;
  const codeOnly = firstAnalysis.codeOnly;
  assert.ok(codeOnly.every((u) => /type "(shadow|duration|cubicBezier)"/.test(u.reason)), codeOnly.map((u) => u.reason).join('\n'));
  for (const p of ['shadow.1', 'elevation.raised', 'motion.duration.fast', 'motion.easing.standard', 'card.shadow']) assert.ok(codeOnly.some((u) => u.path === p), p);
  assert.equal(pull.plan.variables.length, total - codeOnly.length);
  // Brand overrides are reported, never written to Figma.
  assert.ok(firstAnalysis.overrides.length > 0);
  assert.ok(firstAnalysis.warnings.some((w) => /brand theme override\(s\) .*brands\/ocean\.light\.tokens\.json.* stay code-only/.test(w)));
  const bg = findIn(snapshot, 'Semantic', 'color/action/primary/bg');
  assert.deepEqual(bg.scopes, ['FRAME_FILL', 'SHAPE_FILL']);
  const brandIds = new Set(findIn(snapshot, 'Brand', 'palette/primary/600') && snapshot.variables.filter((v) => v.collectionId === 'c:Brand').map((v) => v.id));
  assert.ok(Object.values(bg.valuesByMode).every((v) => v.kind === 'alias' && brandIds.has(v.id)), 'semantic aliases Brand variables');
  const palette = findIn(snapshot, 'Brand', 'palette/neutral/50');
  assert.notEqual(palette.valuesByMode['Brand:bridge'], palette.valuesByMode['Brand:ocean'], 'one value per brand');
  assert.deepEqual(palette.scopes, [], 'palette roles are not offered in pickers');
  assert.deepEqual(findIn(snapshot, 'Primitives', 'color/steel/50').scopes, []);
  assert.equal(findIn(snapshot, 'Primitives', 'font/family/plex-sans').valuesByMode['Primitives:value']?.kind, 'string');
  const compId = findIn(snapshot, 'Semantic', 'color/action/primary/bg').id;
  assert.deepEqual(findIn(snapshot, 'Component', 'button/primary/bg').valuesByMode['Component:value'], { kind: 'alias', id: compId });
  assert.equal(findIn(snapshot, 'Density', 'control/height/md').valuesByMode['Density:compact']?.kind, 'alias');
});

for (const layout of ['single', 'split'] as const) {
  test(`round trip through Figma is lossless (${layout} layout): no changes, no files`, async () => {
    const { client, snapshot, sync } = await pulled(layout);
    if (layout === 'split') assert.ok(snapshot.collections.some((c) => c.name === 'Brand/Ocean') && snapshot.collections.some((c) => c.name === 'Semantic/Dark'));
    const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
    assert.equal(a.figma.layout, layout === 'single' ? 'single-collection' : 'split-collections');
    assert.deepEqual([a.diff.local.length, a.diff.remote.length, a.diff.conflicts.length], [0, 0, 0]);
    const push = buildPush(a, new Map());
    assert.deepEqual(push.files, {});
  });
}

test('push: edits in Figma become a minimal PR with only the changed files', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  // 1. Re-point a semantic token (light) to another palette role.
  alias(snapshot, 'Semantic', 'color/action/primary/bg', 'Light', 'Brand', 'palette/primary/700');
  // 2. Change a primitive value (float32 noise included) and its description.
  const s50 = findIn(snapshot, 'Primitives', 'color/steel/50');
  s50.valuesByMode['Primitives:value'] = { kind: 'color', r: Math.fround(0.94), g: Math.fround(0.95), b: Math.fround(0.96), a: 1 };
  s50.description = 'Subtle background';
  // 3. Rename a variable (keeps its plugin data id).
  findIn(snapshot, 'Primitives', 'radius/3xl').name = 'radius/4xl';
  // 4. New variable created in Figma (no plugin data).
  snapshot.variables.push({
    id: 'new1',
    name: 'space/32',
    collectionId: 'c:Primitives',
    resolvedType: 'FLOAT',
    description: '',
    scopes: ['GAP', 'WIDTH_HEIGHT'],
    valuesByMode: { 'Primitives:value': { kind: 'float', value: 128 } },
    pluginData: {},
  });

  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const kinds = Object.fromEntries(a.diff.local.map((e) => [e.path, e.local!.kind]));
  // Ocean's radius.overlay aliases radius.3xl: the rename reaches it through the alias.
  assert.deepEqual(kinds, { 'color.action.primary.bg': 'changed', 'color.steel.50': 'changed', 'radius.4xl': 'renamed', 'radius.overlay': 'changed', 'space.32': 'added' });

  const push = buildPush(a, new Map());
  assert.deepEqual(push.validation.blocking, []);
  assert.deepEqual(Object.keys(push.files).sort(), [
    'brands/ocean.tokens.json',
    'primitives/color.tokens.json',
    'primitives/radius.tokens.json',
    'primitives/space.tokens.json',
    'semantic/light.tokens.json',
  ]);
  const original = realFiles();
  const changedLines = (file: string) => {
    const before = original[file]!.split('\n');
    return push.files[file]!.split('\n').filter((l, i) => l !== before[i]);
  };
  assert.deepEqual(changedLines('semantic/light.tokens.json').map((l) => l.trim()), ['"$value": "{palette.primary.700}",']);
  assert.match(push.files['primitives/space.tokens.json']!, /"32": \{\n\s+"\$value": \{\n\s+"value": 128,\n\s+"unit": "px"\n\s+\}\n\s+\}\n  \}\n\}\n$/);
  assert.match(push.files['primitives/radius.tokens.json']!, /"4xl": \{\n\s+"\$value": \{\n\s+"value": 20,\n\s+"unit": "px"\n\s+\},\n\s+"\$extensions": \{\n\s+"com\.dsbridge\.id": "path:radius\.3xl"/);
  assert.match(push.files['primitives/color.tokens.json']!, /"\$description": "Subtle background",\n\s+"\$value": \{\n\s+"colorSpace": "srgb",\n\s+"components": \[\n\s+0\.94,/);
  // Ocean overrides the primary action in light: the edit does not reach it, and the designer is told.
  assert.ok(push.validation.warnings.some((w) => w.code === 'override-shadowed' && w.path === 'color.action.primary.bg' && w.mode === 'ocean.light'));

  const result = await openPullRequest(client, a, push, { title: '', notes: '', fileName: 'Test', now: new Date(Date.UTC(2026, 9, 16, 14, 5)) });
  assert.match(result.branch, /^tokens\/[a-z0-9-]+-20261016-1405$/);
  const pr = gh.prs[0]!;
  assert.equal(pr.draft, true);
  assert.deepEqual(pr.labels, ['tokens']);
  assert.match(pr.body, /Tier 3: token change, needs design \+ tech approval/);
  const primary = row(pr.body, 'color.action.primary.bg');
  assert.equal(primary[1], 'Semantic');
  assert.match(primary[3]!, /^Light: `palette\.primary\.\d+ \(#[0-9a-f]{6}\)` -> `palette\.primary\.700 \(#4b5562\)`<br>Dark: `palette\.primary\.\d+ \(#[0-9a-f]{6}\)`/);
  assert.match(primary[4]!, /Bridge light, color\.action\.primary\.text on color\.action\.primary\.bg: \d+(\.\d+)? -> \d+(\.\d+)? (AAA|AA|fail)/);
  assert.doesNotMatch(primary[4]!, /Ocean|dark/, 'ocean overrides it; dark did not change');
  // A primitive change shows the pairs it reaches through palette roles.
  assert.match(row(pr.body, 'color.steel.50')[4]!, /Bridge light, color\.text\.\w+ on color\.bg\.default: \d+(\.\d+)? -> \d+(\.\d+)?/);
  assert.equal(pr.body.includes(String.fromCharCode(0x2014)), false, 'no em dash in the PR body');
  // One commit on top of main holding only the changed files plus a changeset.
  const commit = gh.commits.get(result.commitSha)!;
  assert.deepEqual(commit.parents, [a.headSha]);
  const mainFiles = gh.filesAt('main');
  const changed = Object.keys(commit.files).filter((f) => commit.files[f] !== mainFiles[f]).sort();
  assert.equal(changed.length, 6);
  assert.ok(changed.some((f) => /^\.changeset\/ds-bridge-.*\.md$/.test(f)));
  const changeset = commit.files[changed.find((f) => f.startsWith('.changeset/'))!]!;
  assert.match(changeset, /"@bridge-ds\/tokens": major/, 'a rename is a breaking change');
  // Variables learn their ids so the next diff matches by id.
  assert.ok(result.tags.some((t) => t.variableId === 'new1' && t.pluginData.id === 'path:space.32' && t.pluginData.file === 'primitives/space.tokens.json'));
});

test('push writes each tier back to its own file and mode', async () => {
  const { client, snapshot, sync } = await pulled();
  alias(snapshot, 'Brand', 'palette/accent/600', 'Ocean', 'Primitives', 'color/sea/700');
  alias(snapshot, 'Density', 'control/height/md', 'Compact', 'Primitives', 'size/9');
  alias(snapshot, 'Component', 'button/secondary/text', 'Value', 'Semantic', 'color/text/default');
  findIn(snapshot, 'Base', 'icon/stroke').valuesByMode['Base:value'] = { kind: 'float', value: 2.25 };
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const push = buildPush(a, new Map());
  assert.deepEqual(push.validation.blocking, []);
  assert.deepEqual(Object.keys(push.files).sort(), ['brands/ocean.tokens.json', 'components/button.tokens.json', 'density/compact.tokens.json', 'semantic/base.tokens.json']);
  assert.match(push.files['brands/ocean.tokens.json']!, /"\{color\.sea\.700\}"/);
  assert.match(push.files['density/compact.tokens.json']!, /"\{size\.9\}"/);
  assert.match(push.files['components/button.tokens.json']!, /"\{color\.text\.default\}"/);
  assert.match(push.files['semantic/base.tokens.json']!, /2\.25/);
});

test('PR #4 regression: changing color.bg.default fills the contrast column with before -> after ratios', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  alias(snapshot, 'Semantic', 'color/bg/default', 'Light', 'Brand', 'palette/neutral/0');
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const push = buildPush(a, new Map());
  assert.deepEqual(push.validation.blocking, []);
  await openPullRequest(client, a, push, { title: 'Canvas tint', notes: '', fileName: 'Test' });
  const cell = row(gh.prs[0]!.body, 'color.bg.default')[4]!;
  assert.notEqual(cell.trim(), '', 'contrast column is filled');
  // Every pair with color.bg.default as foreground or background, in both brands, light only. The cell lists the
  // biggest moves and points to the Contrast impact table for the rest, which lists every pair.
  for (const brand of ['Bridge', 'Ocean']) {
    assert.match(gh.prs[0]!.body, new RegExp(`\\| \`color\\.text\\.default\` on \`color\\.bg\\.default\` \\| ${brand} light \\| \\d+(\\.\\d+)? \\| \\d+(\\.\\d+)? \\| 4\\.5 \\| (AAA|AA) \\|`));
  }
  assert.doesNotMatch(cell, /dark/);
  const lines = cell.split('<br>');
  const more = /^and \d+ more \(see Contrast impact\)( \|)?$/;
  assert.ok(lines.every((l, i) => /^(Bridge|Ocean) light, \S+ on \S+: \d+(\.\d+)? -> \d+(\.\d+)?/.test(l) || (i === lines.length - 1 && more.test(l))), cell);
  assert.ok(lines.some((l) => { const m = /: ([\d.]+) -> ([\d.]+)/.exec(l)!; return m[1] !== m[2]; }), 'ratios moved');
  assert.match(gh.prs[0]!.body, /### Contrast impact/);
});

test('PR #4 regression: a brand palette change shows the pairs it reaches through semantic aliases', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  // color.bg.default (light) -> palette.neutral.50 -> primitive. Change the Bridge palette role only.
  alias(snapshot, 'Brand', 'palette/neutral/50', 'Bridge', 'Primitives', 'color/white');
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const push = buildPush(a, new Map());
  assert.deepEqual(Object.keys(push.files), ['brands/bridge.tokens.json']);
  assert.deepEqual(push.validation.blocking, []);
  await openPullRequest(client, a, push, { title: 'Bridge canvas', notes: '', fileName: 'Test' });
  const cells = row(gh.prs[0]!.body, 'palette.neutral.50');
  assert.equal(cells[1], 'Brand');
  assert.match(cells[3]!, /^Bridge: `color\.steel\.50 \(#[0-9a-f]{6}\)` -> `color\.white \(#ffffff\)`<br>Ocean: .* \(unchanged\)$/);
  assert.match(gh.prs[0]!.body, /\| `color\.text\.default` on `color\.bg\.default` \| Bridge light \| \d+(\.\d+)? \| \d+(\.\d+)? \|/);
  assert.match(cells[4]!, /^Bridge light, /);
  assert.doesNotMatch(cells[4]!, /Ocean/, 'the ocean palette did not change');
});

test('guardrails block raw values, wrong tiers, broken contrast and ALL_SCOPES', async () => {
  const { client, snapshot, sync } = await pulled();
  alias(snapshot, 'Semantic', 'color/text/default', 'Light', 'Brand', 'palette/neutral/200');
  alias(snapshot, 'Semantic', 'color/text/disabled', 'Light', 'Primitives', 'color/steel/400');
  findIn(snapshot, 'Semantic', 'color/text/muted').valuesByMode[modeId(snapshot, 'Semantic', 'Light')] = { kind: 'color', r: 0.3, g: 0.3, b: 0.3, a: 1 };
  findIn(snapshot, 'Semantic', 'color/border/default').scopes = ['ALL_SCOPES'];
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const push = buildPush(a, new Map());
  const codes = push.validation.blocking.map((i) => `${i.code}:${i.path}`);
  assert.ok(codes.includes('raw-value:color.text.muted'), codes.join('\n'));
  assert.ok(codes.includes('alias-tier:color.text.disabled'), codes.join('\n'));
  assert.ok(codes.includes('contrast:color.text.default on color.bg.default'), codes.join('\n'));
  assert.ok(codes.includes('all-scopes:color.border.default'), codes.join('\n'));
  await assert.rejects(openPullRequest(client, a, push, { title: 't', notes: '', fileName: 'x' }), /blocking/);
});

test('conflicts are surfaced and nothing is overwritten until the user picks', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  gh.pushToMain((files) => setValue(files, 'semantic/dark.tokens.json', 'color.action.primary.bg', '{palette.primary.500}'));
  alias(snapshot, 'Semantic', 'color/action/primary/bg', 'Dark', 'Brand', 'palette/primary/300');
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  assert.deepEqual(a.diff.conflicts.map((c) => c.path), ['color.action.primary.bg']);

  const unresolved = buildPush(a, new Map());
  assert.equal(unresolved.unresolvedConflicts.length, 1);
  assert.deepEqual(unresolved.files, {});
  await assert.rejects(openPullRequest(client, a, unresolved, { title: 't', notes: '', fileName: 'x' }), /conflict/);

  const keepFigma = buildPush(a, new Map([[a.diff.conflicts[0]!.id, 'figma']]));
  assert.match(keepFigma.files['semantic/dark.tokens.json']!, /"\$value": "\{palette\.primary\.300\}"/);

  const pullMain = buildPull(a, new Map([[a.diff.conflicts[0]!.id, 'main']]));
  const planned = pullMain.plan.variables.find((v) => v.path === 'color.action.primary.bg')!;
  assert.deepEqual(planned.values.dark, { kind: 'alias-token', path: 'palette.primary.500', tokenId: 'path:palette.primary.500', tier: 'brand' });
  const pullKeep = buildPull(a, new Map());
  assert.equal(pullKeep.plan.variables.some((v) => v.path === 'color.action.primary.bg'), false, 'unresolved conflict is left alone');
});

test('pull keeps local edits and flags tokens removed on main as orphans', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  gh.pushToMain((files) => {
    const f = `${PREFIX}/primitives/radius.tokens.json`;
    const doc = parseTokenFile(f, files[f]!);
    removeToken(doc, 'radius.3xl');
    files[f] = serializeTokenFile(doc);
  });
  findIn(snapshot, 'Primitives', 'radius/sm').valuesByMode['Primitives:value'] = { kind: 'float', value: 3 };
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const pull = buildPull(a, new Map());
  assert.deepEqual(pull.kept.map((e) => e.path), ['radius.sm']);
  assert.equal(pull.plan.variables.some((v) => v.path === 'radius.sm'), false);
  assert.deepEqual(pull.plan.orphans.map((o) => o.name), ['radius/3xl']);
  const after = applyPlanToSnapshot(pull.plan, 'single', snapshot);
  const lg = findIn(after, 'Primitives', 'radius/3xl');
  assert.equal(lg.pluginData.orphan, true);
  assert.match(lg.description, /^\[orphan\] /);
  // After the pull the orphan is not reported as a Figma-side addition.
  const next = await analyze(client, DEFAULT_SETTINGS, { baseSha: pull.plan.headSha }, after);
  assert.deepEqual(next.diff.local.map((e) => [e.path, e.local!.kind]).sort(), [['radius.3xl', 'added'], ['radius.sm', 'changed']]);
});

test('rename without plugin data is only a suggestion until confirmed', async () => {
  const { client, snapshot, sync } = await pulled();
  const v = findIn(snapshot, 'Semantic', 'color/text/muted');
  v.name = 'color/text/subtle';
  v.pluginData = {};
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot as FigmaSnapshot);
  assert.deepEqual(a.suggestions.map((s) => [s.fromPath, s.toPath]), [['color.text.muted', 'color.text.subtle']]);
  const own = (r: typeof a) => r.diff.local.filter((e) => e.path.startsWith('color.text.')).map((e) => [e.path, e.local!.kind]);
  assert.deepEqual(own(a).sort(), [['color.text.muted', 'removed'], ['color.text.subtle', 'added']]);
  // Component tokens alias the variable, so Figma renames their references too.
  const referrers = a.diff.local.filter((e) => !e.path.startsWith('color.text.'));
  assert.ok(referrers.length > 0 && referrers.every((e) => e.figma!.tier === 'component' && e.local!.kind === 'changed'));
  const confirmed: RenameSuggestion[] = a.suggestions;
  const b = await analyze(client, DEFAULT_SETTINGS, sync, snapshot, confirmed);
  assert.deepEqual(own(b), [['color.text.subtle', 'renamed']]);
  const push = buildPush(b, new Map());
  for (const file of ['semantic/light.tokens.json', 'semantic/dark.tokens.json']) {
    const doc = parseTokenFile(file, push.files[file]!);
    const subtle = readTokenAt(doc, 'color.text.subtle')!;
    assert.match(String(subtle.value), /^\{palette\.neutral\.\d+\}$/);
    assert.equal(subtle.extensions?.['com.dsbridge.id'], 'path:color.text.muted');
    assert.equal(readTokenAt(doc, 'color.text.muted'), undefined);
  }
  assert.deepEqual(push.validation.blocking, [], 'referrers were re-pointed, nothing is broken');
  assert.match(push.files['components/data.tokens.json']!, /"\{color\.text\.subtle\}"/);
});

test('bridge.config.json in the repo decides the tokens root, even when the settings say otherwise', async () => {
  const gh = new FakeGitHub(repoFiles());
  const a = await analyze(gh.client(), { ...DEFAULT_SETTINGS, tokensPath: 'somewhere/else' }, {}, { fileName: 'Test', collections: [], variables: [] });
  assert.equal(a.headFiles.tokensPath, 'packages/tokens/src');
  assert.equal(a.headFiles.config?.changeset?.package, '@bridge-ds/tokens');
  assert.ok(a.pairs.length > 0);
  // Without a config the settings path is used, and no changeset package is known.
  const files = repoFiles();
  delete files['bridge.config.json'];
  const b = await analyze(new FakeGitHub(files).client(), DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  assert.equal(b.headFiles.config, undefined);
  assert.equal(b.head.tokens.size, a.head.tokens.size);
});

test('appending to an open PR adds a commit on its branch', async () => {
  const { gh, client, snapshot, sync } = await pulled();
  findIn(snapshot, 'Primitives', 'radius/sm').valuesByMode['Primitives:value'] = { kind: 'float', value: 3 };
  const a = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const first = await openPullRequest(client, a, buildPush(a, new Map()), { title: 'Radius tweak', notes: '', fileName: 'x' });
  findIn(snapshot, 'Primitives', 'radius/md').valuesByMode['Primitives:value'] = { kind: 'float', value: 7 };
  const b = await analyze(client, DEFAULT_SETTINGS, sync, snapshot);
  const second = await openPullRequest(client, b, buildPush(b, new Map()), { title: 'Radius tweak 2', notes: '', fileName: 'x', appendTo: first.pr });
  assert.equal(second.appended, true);
  assert.equal(second.branch, first.branch);
  assert.equal(gh.prs.length, 1);
  assert.deepEqual(gh.commits.get(second.commitSha)!.parents, [first.commitSha]);
  const radius = parseTokenFile('r', gh.filesAt(first.branch)[`${PREFIX}/primitives/radius.tokens.json`]!);
  assert.deepEqual(readTokenAt(radius, 'radius.md')!.value, { value: 7, unit: 'px' });
  assert.deepEqual(readTokenAt(radius, 'radius.sm')!.value, { value: 3, unit: 'px' });
});
