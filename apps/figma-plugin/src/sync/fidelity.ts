// Fidelity check (Pull tab, "Check fidelity"): compares each generated component set with images of the same
// variants rendered from code. The code images are published by the repo's Figma references workflow to the
// `bridge-visual` branch (figma-references/manifest.json + PNGs) and read with the GitHub token the plugin already
// has, through api.github.com: no new domain, the token goes nowhere new. Figma exports come from the main thread.
// Images are decoded by the caller (a canvas in the UI), so this file stays testable in Node. Nothing is changed.

import {
  FIGMA_REFERENCES_BRANCH,
  FIGMA_REFERENCES_DIR,
  FIGMA_REFERENCES_MANIFEST,
  buildFidelityReport,
  compareImages,
  summarizeComponent,
  type CompareOptions,
  type FidelityComponentResult,
  type FidelityReport,
  type FidelityVariantResult,
  type FigmaReferenceManifest,
  type GitHubClient,
  type RgbaImage,
} from '@bridge-ds/core';
import type { GeneratedSet } from './component-pull';

export interface FidelityDeps {
  client: Pick<GitHubClient, 'getFileText' | 'getFileBase64'>;
  /** Generated sets in the file (scan-generated). */
  sets: GeneratedSet[];
  /** Main thread export: variant key -> PNG base64. */
  exportVariants: (nodeId: string, keys: string[], scale: number) => Promise<Record<string, string>>;
  decode: (pngBase64: string) => Promise<RgbaImage>;
  /** RGBA -> PNG data URL for the diff overlay. */
  encode: (img: RgbaImage) => Promise<string>;
  progress?: (message: string) => void;
  fileName?: string;
  options?: CompareOptions;
  now?: Date;
  /**
   * What the sets are compared with. Default: the code images the repo's Figma references workflow publishes. A
   * measured-only pull passes the screenshots of the stories its sets were built from (any design system).
   */
  reference?: { manifest: FigmaReferenceManifest; image: (file: string) => Promise<string | undefined> } | undefined;
}

/** One component in the UI: its result, and the images of the variant that differs most. */
export interface FidelityItem {
  nodeId: string;
  name: string;
  result: FidelityComponentResult;
  /** Worst variant: Figma and code PNG base64, the diff overlay as a data URL. */
  images?: { key: string; figma: string; code: string; diff: string } | undefined;
}

export type FidelityOutcome =
  | { kind: 'done'; report: FidelityReport; items: FidelityItem[] }
  | { kind: 'no-references' }
  | { kind: 'no-sets' };

export const NO_REFERENCES_TEXT = 'Images of the code are not published yet. They are made each time a change ships to the library; ask a developer to run the "Figma references" check once.';

/** Reads the published manifest, or undefined when the repo has none yet. */
export async function loadReferenceManifest(client: FidelityDeps['client']): Promise<FigmaReferenceManifest | undefined> {
  const text = await client.getFileText(FIGMA_REFERENCES_MANIFEST, FIGMA_REFERENCES_BRANCH);
  if (!text) return undefined;
  const m = JSON.parse(text) as FigmaReferenceManifest;
  if (m.version !== 1 || !m.components) throw new Error('The code images were made by a newer Bridge. Update the Bridge plugin.');
  return m;
}

export async function runFidelityCheck(d: FidelityDeps): Promise<FidelityOutcome> {
  if (!d.sets.length) return { kind: 'no-sets' };
  const manifest = d.reference?.manifest ?? (await loadReferenceManifest(d.client));
  if (!manifest) return { kind: 'no-references' };
  const options: CompareOptions = { ...d.options, scale: manifest.scale };
  const items: FidelityItem[] = [];
  for (const [i, set] of d.sets.entries()) {
    const entry = manifest.components[set.componentId];
    if (!entry) {
      items.push({ nodeId: set.nodeId, name: set.name, result: summarizeComponent(set.componentId, [], 'no image of its code yet, it is new or not drawn from code') });
      continue;
    }
    // The code version the set was drawn from: its static spec hash, also when measured values were laid on.
    if (entry.specHash !== (set.codeHash || set.specHash)) {
      items.push({
        nodeId: set.nodeId,
        name: set.name,
        result: summarizeComponent(set.componentId, [], 'this set and the code images come from different versions. Update the component from Pull, then check again'),
      });
      continue;
    }
    // A run takes minutes on a full library: say how far it is.
    d.progress?.(`Comparing ${set.name}, ${i + 1} of ${d.sets.length}`);
    const comparable = set.variants.filter((k) => entry.variants[k] && 'file' in entry.variants[k]!);
    const exports = comparable.length ? await d.exportVariants(set.nodeId, comparable, manifest.scale) : {};
    const variants: FidelityVariantResult[] = [];
    const kept = new Map<string, { figma: string; code: string; f: RgbaImage; c: RgbaImage }>();
    for (const key of set.variants) {
      const ref = entry.variants[key];
      if (!ref) {
        variants.push({ key, status: 'skipped', reason: 'no image of this variant in the code' });
        continue;
      }
      if (!('file' in ref)) {
        variants.push({ key, status: 'skipped', reason: ref.skipped });
        continue;
      }
      const figma = exports[key];
      if (!figma) {
        variants.push({ key, status: 'skipped', reason: 'Figma could not export this variant' });
        continue;
      }
      const code = d.reference ? await d.reference.image(ref.file) : (await d.client.getFileBase64(`${FIGMA_REFERENCES_DIR}/${ref.file}`, FIGMA_REFERENCES_BRANCH))?.base64;
      if (!code) {
        variants.push({ key, status: 'skipped', reason: 'its code image is missing' });
        continue;
      }
      const [f, c] = await Promise.all([d.decode(figma), d.decode(code)]);
      const r = compareImages(f, c, { ...options, diffImage: false });
      variants.push({ key, status: r.matches ? 'matches' : 'differs', percent: r.percent, size: r.size });
      kept.set(key, { figma, code, f, c });
    }
    const result = summarizeComponent(set.componentId, variants);
    const worst = result.worst && kept.get(result.worst.key);
    let images: FidelityItem['images'];
    if (worst && result.worst) {
      const diff = compareImages(worst.f, worst.c, options).diff!;
      images = { key: result.worst.key, figma: worst.figma, code: worst.code, diff: await d.encode(diff) };
    }
    items.push({ nodeId: set.nodeId, name: set.name, result, images });
  }
  const report = buildFidelityReport({
    components: items.map((i) => i.result),
    reference: { sha: manifest.sha, createdAt: manifest.createdAt },
    options,
    ...(d.fileName ? { file: d.fileName } : {}),
    ...(d.now ? { now: d.now } : {}),
  });
  return { kind: 'done', report, items };
}

/** One sentence for the whole check. */
/**
 * The screen's headline while a comparison runs or once it is done: what the designer learns, never "Up to date" above
 * a list of differences.
 */
export function fidelityHeadline(f: { running?: string | undefined; error?: string | undefined; outcome?: FidelityOutcome | undefined }): string {
  if (f.running) return 'Comparing with the code';
  if (f.error) return 'Could not compare with the code';
  const o = f.outcome;
  if (!o) return 'Compare with the code';
  if (o.kind === 'no-references') return "Can't compare yet";
  if (o.kind === 'no-sets') return 'Nothing to compare yet';
  const { differs, matches, notChecked } = o.report.summary;
  if (differs) return `${differs} ${differs === 1 ? 'component differs' : 'components differ'} from the code`;
  if (matches) return 'Figma matches the code';
  return notChecked ? 'Nothing could be compared' : 'Nothing to compare yet';
}

/** One designer sentence for a set that differs (the pixel figures stay one click away, under its variants). */
export const differsSentence = (r: { differing: number; checked: number }) =>
  r.checked > 1 ? `Looks different from the code in ${r.differing} of ${r.checked} variants.` : 'Looks different from the code.';

export function fidelitySummary(r: FidelityReport): string {
  const { matches, differs, notChecked } = r.summary;
  const parts = [differs ? `${differs} ${differs === 1 ? 'component differs' : 'components differ'} from the code` : '', matches ? `${matches} ${matches === 1 ? 'matches' : 'match'}` : '', notChecked ? `${notChecked} not compared` : ''].filter(Boolean);
  return `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
}
