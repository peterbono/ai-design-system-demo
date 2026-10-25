// Push in suggest mode ("changes": "suggest" in bridge.config.json, the default): the checked variable edits and every
// component change become suggestions (GitHub issues holding the exact change), never a branch or a pull request.
// With a suggest-only token (Contents Read, Issues Read and write, Pull requests Read) nothing touches git; with a
// token that can write contents the screenshot still goes to the bridge-requests branch and is linked. Direct mode
// is unchanged (the other test files cover it). Over the in-memory Figma and FakeGitHub.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LayeredTokenSet, REQUESTS_BRANCH, applyTokenEdits, buildTokenSet, layoutOptions, loadConfig, parseSuggestionIssue, type SuggestionPayloadV1 } from '@bridge-ds/core';
import { componentPushes } from '../src/sync/component-push';
import { type RawComponent, type ScannedComponent, buildSignature, classifyComponents, fnv1a, suggestLine, suggestSummary, suggestTitle } from '../src/sync/components';
import { analyze, buildPull, buildPush, changesModeOf, tokenEditsOf } from '../src/sync/flows';
import { IMAGES_NEED_WRITE, publish, sendLabel, sentTitle, tokenHelp } from '../src/sync/publish';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { FakeGitHub } from './fake-github';
import { applyPlanToSnapshot, findIn } from './figma-sim';
import { realChecksText, realConfigText, realFiles } from './helpers';

const PREFIX = DEFAULT_SETTINGS.tokensPath;

/** This repo's files with "changes" set to `mode` (absent: the key removed, so the default applies). */
function repoFiles(mode: 'suggest' | 'direct' | 'absent' | 'no-config' = 'suggest'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${PREFIX}/${rel}`] = text;
  out[`${PREFIX}/contrast.checks.json`] = realChecksText();
  if (mode !== 'no-config') {
    const config = JSON.parse(realConfigText()) as Record<string, unknown>;
    if (mode === 'absent') delete config.changes;
    else config.changes = mode;
    out['bridge.config.json'] = `${JSON.stringify(config, null, 2)}\n`;
  }
  out['packages/react/src/components/Button/Button.tsx'] = '';
  return out;
}

/** A pulled file with two variable edits: a radius (primitive) and a space step. */
async function edited(gh: FakeGitHub) {
  const client = gh.client();
  const first = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const pull = buildPull(first, new Map());
  const snapshot = applyPlanToSnapshot(pull.plan, 'single');
  findIn(snapshot, 'Primitives', 'radius/sm').valuesByMode['Primitives:value'] = { kind: 'float', value: 5 };
  findIn(snapshot, 'Primitives', 'space/3').valuesByMode['Primitives:value'] = { kind: 'float', value: 13 };
  const a = await analyze(client, DEFAULT_SETTINGS, { baseSha: pull.plan.headSha }, snapshot);
  return { client, a, proposal: buildPush(a, new Map()) };
}

const payloadOf = (gh: FakeGitHub, n: number): SuggestionPayloadV1 => {
  const issue = gh.issues.find((i) => i.number === n)!;
  const parsed = parseSuggestionIssue(issue.body);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.payload;
};

/** No branch other than main (and the requests branch when allowed), no pull request, no commit. */
function assertNoCodeWrites(gh: FakeGitHub, allowRequestsBranch = false) {
  assert.deepEqual([...gh.branches.keys()].filter((b) => !(allowRequestsBranch && b === REQUESTS_BRANCH)), ['main']);
  assert.equal(gh.prs.length, 0);
  assert.deepEqual(gh.gitWrites.filter((m) => !(allowRequestsBranch && (m === 'createBranch' || m === 'putBase64File'))), []);
}

test('mode: bridge.config.json "changes", suggest by default; a repo with no config stays direct', async () => {
  for (const [mode, want] of [['suggest', 'suggest'], ['direct', 'direct'], ['absent', 'suggest'], ['no-config', 'direct']] as const) {
    const gh = new FakeGitHub(repoFiles(mode));
    const a = await analyze(gh.client(), DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
    assert.equal(changesModeOf(a), want, mode);
  }
});

test('suggest, read-only token: the variable edits are one token suggestion with the exact edits; no git or pull request write', async () => {
  const gh = new FakeGitHub(repoFiles('suggest')).readOnly();
  const { client, a, proposal } = await edited(gh);
  assert.equal(changesModeOf(a), 'suggest');
  const res = await publish(client, { analysis: a, proposal, components: [], unchecked: new Set(), description: 'Rounder small corners.', title: '', fileName: 'Test', fileKey: 'FILEKEY', coded: [], requestedBy: 'dana', mode: changesModeOf(a) });
  assertNoCodeWrites(gh);
  assert.equal(res.pr, undefined);
  assert.equal(res.suggestions.length, 1);
  const s = res.suggestions[0]!;
  assert.equal(s.kind, 'variables');
  const p = payloadOf(gh, s.number);
  assert.equal(p.kind, 'token-change');
  assert.equal(p.source, 'figma');
  assert.equal(p.suggestedBy, 'dana');
  assert.equal(p.summary, 'Rounder small corners.');
  assert.deepEqual(p.base, { ref: 'main', sha: a.headSha });
  assert.deepEqual(p.links?.figma, { fileKey: 'FILEKEY', url: 'https://www.figma.com/design/FILEKEY/' });
  assert.deepEqual(p.tokens!.edits.map((e) => `${e.op} ${e.path}`).sort(), ['set radius.sm', 'set space.3']);
  assert.ok(p.tokens!.edits.every((e) => e.file), 'each edit names its token file');
  const issue = gh.issues.find((i) => i.number === s.number)!;
  assert.ok(issue.labels.includes('bridge-suggestion') && issue.labels.includes('source: figma') && issue.labels.includes('suggestion: token-change'), issue.labels.join());
  assert.equal(sentTitle(res, 'suggest'), 'Suggestion sent to your DS lead');
  assert.ok(res.tags?.length, 'variables are tagged so the next diff matches them');

  // Applied on main, the edits give the same tokens the direct push would have committed.
  const config = loadConfig(gh.filesAt('main')['bridge.config.json']!);
  const files = new Map(Object.entries(a.headFiles.files));
  const applied = applyTokenEdits(new LayeredTokenSet(config, files), p.tokens!.edits);
  const set = buildTokenSet(Object.fromEntries(applied.files), layoutOptions(config));
  const direct = buildTokenSet({ ...a.headFiles.files, ...proposal.files }, layoutOptions(config));
  for (const path of ['radius.sm', 'space.3']) assert.deepEqual(set.byPath.get(path)!.values, direct.byPath.get(path)!.values, path);
});

test('direct: the same push still opens a branch and a draft pull request (behaviour kept)', async () => {
  const gh = new FakeGitHub(repoFiles('direct'));
  const { client, a, proposal } = await edited(gh);
  const res = await publish(client, { analysis: a, proposal, components: [], unchecked: new Set(), description: 'Rounder small corners.', title: '', fileName: 'Test', coded: [], mode: changesModeOf(a) });
  assert.equal(res.suggestions.length, 0);
  assert.ok(res.pr && gh.branches.has(res.pr.branch));
  assert.equal(gh.prs.length, 1);
  assert.equal(gh.issues.length, 0);
  assert.equal(sentTitle(res, 'direct'), 'Sent for review');
});

test('suggest: an exploration (a branch) is refused before anything is written', async () => {
  const gh = new FakeGitHub(repoFiles('suggest'));
  const { client, a, proposal } = await edited(gh);
  const target = { branch: 'explore/x', pr: { number: 9, url: 'u', title: 't', draft: true, headRef: 'explore/x' } };
  await assert.rejects(publish(client, { analysis: a, proposal, components: [], unchecked: new Set(), description: '', title: '', fileName: 'Test', coded: [], mode: 'suggest', exploration: target }), /takes changes as suggestions/);
  assertNoCodeWrites(gh);
  assert.equal(gh.issues.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Components

function raw(name: string, nodeId: string, sizes: string[]): RawComponent {
  return {
    nodeId,
    name,
    definitions: [{ name: 'Size', type: 'VARIANT', default: sizes[0]!, options: sizes }],
    variants: sizes.map((s) => ({ props: { Size: s }, bindings: [{ kind: 'fill', variable: 'button/primary/bg', value: '1,1,1,255' }], render: fnv1a(`${name} ${s}`), structure: fnv1a(name) })),
  };
}

/** Button gains a lg size in Figma: a change that needs code (Claude AI drafts it). */
async function newVariant(gh: FakeGitHub) {
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const found: ScannedComponent[] = [[raw('Button', '1:1', ['sm', 'md']), raw('Button', '1:1', ['sm', 'md', 'lg'])]].map(([base, cur]) => ({ nodeId: cur!.nodeId, name: cur!.name, signature: buildSignature(cur!), baseline: buildSignature(base!) }));
  const scan = classifyComponents(found, ['Button']);
  const pushes = componentPushes(scan.changed, { head: a.head, files: a.headFiles, pairs: a.pairs, scanned: found, coded: scan.coded, fileKey: 'FILE', text: (i) => ({ title: suggestTitle(i), summary: suggestSummary(i), line: suggestLine(i) }) });
  assert.equal(pushes[0]!.plan.route, 'claude-draft');
  const send = () => publish(client, { analysis: a, proposal: buildPush(a, new Map()), components: scan.changed, pushes, unchecked: new Set(), description: '', descriptionIsDraft: true, title: '', fileName: 'Test', fileKey: 'FILE', coded: scan.coded, image: async () => 'iVBORw0KGgo=', mode: changesModeOf(a) });
  return { send };
}

test('suggest, read-only token: a component change is a component spec suggestion with the Figma node links, no image, no git write', async () => {
  const gh = new FakeGitHub(repoFiles('suggest')).readOnly();
  const res = await (await newVariant(gh)).send();
  assert.deepEqual(res.failed, []);
  assert.deepEqual(res.branches, []);
  assert.equal(res.imagesSkipped, true, 'the UI says images need write access');
  // The only write tried is the screenshot's requests branch, refused by GitHub: nothing was written.
  assert.deepEqual(gh.gitWrites, ['createBranch']);
  gh.gitWrites.length = 0;
  assertNoCodeWrites(gh);
  assert.equal(gh.binaries.size, 0);
  const s = res.suggestions[0]!;
  assert.equal(s.kind, 'component-spec');
  assert.equal(s.component, 'Button');
  const p = payloadOf(gh, s.number);
  assert.equal(p.kind, 'component-spec');
  assert.equal(p.previews, undefined);
  assert.deepEqual(p.links?.figma?.nodes, [{ nodeId: '1:1', state: 'after', name: 'Button', url: 'https://www.figma.com/design/FILE/?node-id=1-1' }]);
  const issue = gh.issues.find((i) => i.number === s.number)!;
  assert.ok(issue.labels.includes('from-figma') && issue.labels.includes('suggestion: component-spec'), issue.labels.join());
  assert.match(issue.body, /Claude Code reads this design straight from Figma/);
  assert.match(p.componentSpec!.brief, /Figma MCP get_design_context \{ fileKey: "FILE", nodeId: "1:1" \}/);
  assert.match(IMAGES_NEED_WRITE, /^Screenshots need write access/);
});

test('suggest, token with contents write: the screenshot goes to the requests branch and is linked next to the node links; no library branch', async () => {
  const gh = new FakeGitHub(repoFiles('suggest'));
  const res = await (await newVariant(gh)).send();
  assert.deepEqual(res.failed, []);
  assert.equal(res.imagesSkipped, undefined);
  assertNoCodeWrites(gh, true);
  assert.equal(gh.binaries.get(REQUESTS_BRANCH)?.size, 1);
  const p = payloadOf(gh, res.suggestions[0]!.number);
  assert.equal(p.previews?.length, 1);
  assert.match(p.previews![0]!.url, new RegExp(`^https://github.com/o/r/blob/${REQUESTS_BRANCH}/`));
  assert.equal(p.links?.figma?.nodes?.[0]?.nodeId, '1:1');
});

test('direct: the component change still opens its library branch with the screenshot (behaviour kept)', async () => {
  const gh = new FakeGitHub(repoFiles('direct'));
  const res = await (await newVariant(gh)).send();
  assert.equal(res.suggestions.length, 0);
  assert.equal(res.branches.length, 1);
  assert.match(res.branches[0]!.branch, /^bridge\/figma-button-/);
  assert.equal(gh.prs.length, 1);
});

// ---------------------------------------------------------------------------------------------
// Pure parts

test('tokenEditsOf: set per file, add, remove, rename', () => {
  const t = (path: string, values: Record<string, unknown>, files: Record<string, string>, description?: string) => ({ id: path, path, type: 'color', tier: 'semantic' as const, values, description, scopes: undefined, files });
  const light = 'semantic/light.tokens.json';
  const dark = 'semantic/dark.tokens.json';
  const edits = tokenEditsOf([
    { current: t('color.a', { light: '#000', dark: '#111' }, { light, dark }), target: t('color.a', { light: '#000', dark: '#222' }, { light, dark }) },
    { current: undefined, target: t('color.b', { light: '#333', dark: '#444' }, { light, dark }) },
    { current: t('color.c', { light: '#555' }, { light }), target: undefined },
    { current: t('color.d', { light: '#666' }, { light }), target: t('color.e', { light: '#666' }, { light }, 'Renamed.') },
  ] as never);
  assert.deepEqual(edits, [
    { op: 'set', path: 'color.a', value: '#222', file: dark },
    { op: 'add', path: 'color.b', value: '#333', type: 'color', file: light },
    { op: 'add', path: 'color.b', value: '#444', type: 'color', file: dark },
    { op: 'remove', path: 'color.c', file: light },
    { op: 'rename', path: 'color.d', newPath: 'color.e' },
    { op: 'set', path: 'color.e', value: '#666', description: 'Renamed.', file: light },
  ]);
});

test('wording per mode: the action, the result and the token help', () => {
  assert.equal(sendLabel('suggest'), 'Send suggestion');
  assert.equal(sendLabel('direct'), 'Send for review');
  assert.equal(sentTitle({ suggestions: [{ kind: 'variables', number: 12, url: 'u' }] }, 'suggest'), 'Suggestion sent to your DS lead');
  assert.equal(sentTitle({ suggestions: [{ kind: 'variables', number: 12, url: 'u' }, { kind: 'component-spec', number: 13, url: 'u' }] }, 'suggest'), '2 suggestions sent to your DS lead');
  assert.match(tokenHelp('suggest'), /"Issues" set to "Read and write", "Contents" and "Pull requests" set to "Read"/);
  assert.doesNotMatch(tokenHelp('suggest'), /Pull requests" and "Issues" set to "Read and write"/);
  assert.match(tokenHelp('direct'), /"Contents", "Pull requests" and "Issues" set to "Read and write"/);
  assert.match(tokenHelp(undefined), /suggestions.*straight to review/);
  // First-run help speaks to designers: no config keys.
  assert.doesNotMatch(tokenHelp(undefined), /"changes"|bridge\.config/);
  for (const s of [tokenHelp(undefined), IMAGES_NEED_WRITE, sendLabel('suggest')]) assert.doesNotMatch(s, /\u2014/);
});
