// Check fidelity: generated sets exported by the real main-thread code (main/fidelity.ts) in the simulated Figma,
// compared with code images from a fake bridge-visual branch. The simulated exportAsync is not a PNG, so images are
// synthetic: decode() turns each export or reference into a plain RGBA image chosen by the test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FIGMA_REFERENCES_BRANCH,
  FIGMA_REFERENCES_DIR,
  FIGMA_REFERENCES_MANIFEST,
  type ComponentSpecsFile,
  type FigmaReferenceManifest,
  type RgbaImage,
  parseComponentSpecs,
  planReferences,
  referenceImagePath,
} from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { exportVariants } from '../src/main/fidelity';
import { selectionInfo } from '../src/main/components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { fidelitySummary, runFidelityCheck, type FidelityDeps } from '../src/sync/fidelity';
import { overlayMeasured, parseMeasuredSpecs } from '../src/sync/measured-specs';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';
const specsText = () => readFileSync(join(ROOT, SPECS_PATH), 'utf8');

async function fileWithSets(edit?: (specs: ComponentSpecsFile) => ComponentSpecsFile) {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  files[SPECS_PATH] = specsText();
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  await applyComponentPlan(writablePlan(buildComponentPlan(edit ? edit(loaded!.specs) : loaded!.specs, loaded!.path, await scanGenerated(), a.head)));
  return { sim, sets: await scanGenerated() };
}

/** A manifest made from the committed specs, like `bridge figma-references` writes it. */
function manifestFor(size: (component: string) => [number, number]): FigmaReferenceManifest {
  const specs = parseComponentSpecs(specsText());
  const m: FigmaReferenceManifest = { version: 1, tool: '@bridge-ds/visual', createdAt: '2026-10-19T00:00:00.000Z', sha: 'abc1234def', scale: 2, mode: { brand: 'bridge', theme: 'light', density: 'comfortable' }, storyId: 'internal-figma-reference--variant', components: {} };
  for (const j of planReferences(specs)) {
    const c = (m.components[j.component] ??= { specHash: j.specHash, variants: {} });
    const [w, h] = size(j.component);
    c.variants[j.key] = j.plan.ok ? { file: referenceImagePath(j.component, j.key), width: w, height: h } : { skipped: j.plan.reason };
  }
  return m;
}

// Synthetic images: "img:<w>x<h>:<gray>" stands for a flat image of that size and gray level.
const fake = (w: number, h: number, gray = 200) => Buffer.from(`img:${w}x${h}:${gray}`).toString('base64');
async function decode(b64: string): Promise<RgbaImage> {
  const text = Buffer.from(b64, 'base64').toString('utf8');
  const m = /^img:(\d+)x(\d+):(\d+)$/.exec(text);
  // A simulated Figma export (a JSON description of the node): a 40x20 CSS px image.
  const [w, h, g] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [80, 40, 200];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([g, g, g, 255], i * 4);
  return { width: w, height: h, data };
}

function deps(sets: FidelityDeps['sets'], manifest: FigmaReferenceManifest | undefined, codeImage: (path: string) => string | undefined): FidelityDeps & { reads: string[]; exports: { nodeId: string; keys: string[]; scale: number }[] } {
  const reads: string[] = [];
  const exportsLog: { nodeId: string; keys: string[]; scale: number }[] = [];
  return {
    reads,
    exports: exportsLog,
    sets,
    client: {
      async getFileText(path: string, ref?: string) {
        reads.push(`${ref}:${path}`);
        return path === FIGMA_REFERENCES_MANIFEST && ref === FIGMA_REFERENCES_BRANCH && manifest ? JSON.stringify(manifest) : undefined;
      },
      async getFileBase64(path: string, ref?: string) {
        reads.push(`${ref}:${path}`);
        const b = ref === FIGMA_REFERENCES_BRANCH && path.startsWith(`${FIGMA_REFERENCES_DIR}/`) ? codeImage(path.slice(FIGMA_REFERENCES_DIR.length + 1)) : undefined;
        return b ? { base64: b, size: b.length } : undefined;
      },
    },
    exportVariants: async (nodeId, keys, scale) => {
      exportsLog.push({ nodeId, keys, scale });
      return exportVariants(nodeId, keys, scale);
    },
    decode,
    encode: async (img) => `data:image/png;base64,${img.width}x${img.height}`,
    now: new Date('2026-10-20T00:00:00.000Z'),
    fileName: 'UI kit',
  };
}

test('sets built from measured values keep the code version the code images record, so fidelity compares them', async () => {
  const measured = parseMeasuredSpecs(readFileSync(join(process.cwd(), 'test/fixtures/measured-specs.json'), 'utf8'));
  measured.stories[0]!.spec!.values.root!.fill = 'button.secondary.bg';
  const { sets } = await fileWithSets((specs) => overlayMeasured(specs, measured).specs);
  const manifest = manifestFor(() => [10, 10]);
  const button = sets.find((s) => s.componentId === 'Button')!;
  assert.notEqual(button.specHash, manifest.components.Button!.specHash, 'built from measured values');
  assert.equal(button.codeHash, manifest.components.Button!.specHash, 'drawn from this version of the code');
  // Static sets: the code version is the spec hash, as before.
  const card = sets.find((s) => s.componentId === 'Card')!;
  assert.equal(card.codeHash, card.specHash);
});

test('a selected generated variant names its code image: the same key as the references manifest (REQ-2)', async () => {
  const { sim, sets } = await fileWithSets();
  const card = sets.find((s) => s.componentId === 'Card')!;
  const variant = sim.nodes.get(card.nodeId)!.children.find((c) => c.name === 'Padding=default')!;
  (sim.currentPage as unknown as { selection: unknown[] }).selection = [variant];
  const info = selectionInfo()!;
  assert.equal(info.generated?.componentId, 'Card');
  const ref = manifestFor(() => [10, 10]).components.Card!.variants[info.generated!.variant];
  assert.ok(ref && 'file' in ref, `the manifest has an image of ${info.generated!.variant}`);
  // The set itself, or a layer inside a variant: no single variant, no code image.
  (sim.currentPage as unknown as { selection: unknown[] }).selection = [sim.nodes.get(card.nodeId)];
  assert.equal(selectionInfo()!.generated, undefined);
});

test('exportVariants: PNG of the requested variants of a generated set, at the asked scale, read only', async () => {
  const { sim, sets } = await fileWithSets();
  const card = sets.find((s) => s.componentId === 'Card')!;
  const before = JSON.stringify(sim.nodes.get(card.nodeId)!.children.map((c) => c.name));
  const calls: unknown[] = [];
  for (const c of sim.nodes.get(card.nodeId)!.children) {
    const orig = c.exportAsync.bind(c);
    c.exportAsync = async (settings?: unknown) => {
      calls.push(settings);
      return orig();
    };
  }
  const out = await exportVariants(card.nodeId, ['Padding=compact', 'Padding=unknown'], 2);
  assert.deepEqual(Object.keys(out), ['Padding=compact']);
  assert.deepEqual(calls, [{ format: 'PNG', constraint: { type: 'SCALE', value: 2 } }]);
  assert.equal(JSON.stringify(sim.nodes.get(card.nodeId)!.children.map((c) => c.name)), before);
  assert.deepEqual(await exportVariants('nope', ['Padding=compact'], 2), {});
});

test('runFidelityCheck: every generated set compared with its code images; a badly built Card is flagged', async () => {
  const { sets } = await fileWithSets();
  // Code renders Card 3 CSS px taller than the Figma export (40x20 CSS px in this simulation); the rest match.
  const manifest = manifestFor((c) => (c === 'Card' ? [40, 23] : [40, 20]));
  const d = deps(sets, manifest, (path) => (path.startsWith('card/') ? fake(80, 46) : fake(80, 40)));
  const out = await runFidelityCheck(d);
  assert.equal(out.kind, 'done');
  if (out.kind !== 'done') return;
  // Only the manifest, the code images and the Figma exports: the token goes to api.github.com only (client).
  assert.ok(d.reads.every((r) => r.startsWith(`${FIGMA_REFERENCES_BRANCH}:${FIGMA_REFERENCES_DIR}/`)));
  assert.ok(d.exports.every((e) => e.scale === 2));
  const card = out.items.find((i) => i.result.component === 'Card')!;
  assert.equal(card.result.status, 'differs');
  assert.deepEqual(card.result.worst?.size, { figma: { width: 40, height: 20 }, code: { width: 40, height: 23 } });
  assert.deepEqual(
    card.result.variants.map((v) => `${v.key}: ${v.status}`),
    ['Padding=none: skipped', 'Padding=compact: differs', 'Padding=default: differs'],
  );
  assert.match(card.result.variants[0]!.reason!, /placeholder/);
  assert.equal(card.images?.diff, 'data:image/png;base64,80x46');
  // Popups drawn open are compared with the popup rendered open; only the menu (drawn from no example) is not checked.
  const open = out.items.filter((x) => x.result.component === 'Menu/Popup');
  for (const i of open) assert.equal(i.result.status, 'not-checked', i.result.component);
  for (const i of out.items.filter((x) => x.result.component !== 'Card' && !open.includes(x))) assert.equal(i.result.status, 'matches', i.result.component);
  assert.equal(out.report.summary.differs, 1);
  assert.equal(out.report.summary.matches, sets.length - 1 - open.length);
  assert.deepEqual(out.report.reference, { sha: 'abc1234def', createdAt: '2026-10-19T00:00:00.000Z' });
  assert.equal(out.report.file, 'UI kit');
  assert.match(fidelitySummary(out.report), new RegExp(`^1 component differs from the code, ${sets.length - 1 - open.length} match`));
});

test('runFidelityCheck: no published images, a set from another version, a set with no code image', async () => {
  const { sets } = await fileWithSets();
  assert.deepEqual(await runFidelityCheck(deps(sets, undefined, () => undefined)), { kind: 'no-references' });
  assert.deepEqual(await runFidelityCheck(deps([], undefined, () => undefined)), { kind: 'no-sets' });
  const manifest = manifestFor(() => [40, 20]);
  manifest.components.Button!.specHash = 'older000';
  delete manifest.components.Tag;
  const out = await runFidelityCheck(deps(sets, manifest, () => fake(80, 40)));
  assert.equal(out.kind, 'done');
  if (out.kind !== 'done') return;
  const byName = (n: string) => out.items.find((i) => i.result.component === n)!.result;
  assert.equal(byName('Button').status, 'not-checked');
  assert.match(byName('Button').reason!, /different versions/);
  assert.equal(byName('Tag').status, 'not-checked');
  assert.match(byName('Tag').reason!, /no image of its code yet/);
  assert.equal(byName('Badge').status, 'matches');
});
