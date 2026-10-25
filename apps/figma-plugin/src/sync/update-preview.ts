// "Review updates", the real "After": before applying an update, the plugin shows the incoming version as the code draws
// it, next to the Figma set as it is now. One variant per set: the set's first variant (its default, the top-left one of
// the set, which leads today's whole-set thumbnail). The code image comes from the measured story shots (measured-specs,
// `shot` per variant) or from the published code images Check fidelity uses, and only when they are of the incoming
// code version: an older image would show the wrong "After".

import { FIGMA_REFERENCES_BRANCH, FIGMA_REFERENCES_DIR, type FigmaReferenceManifest } from '@bridge-ds/core';
import type { LoadedSpecs, PlannedComponent } from './component-pull';

/** The variant a preview shows: the set's first (default) variant. */
export const previewKey = (c: Pick<PlannedComponent, 'variants'>): string | undefined => c.variants[0]?.key;

/** Where the code image of that variant is, for the incoming version, or undefined when there is none. */
export function codeImageSource(
  c: Pick<PlannedComponent, 'name' | 'componentId' | 'codeHash' | 'hash'>,
  key: string,
  refs: FigmaReferenceManifest | undefined,
  shots: LoadedSpecs['shots'],
  branch: string,
): { path: string; ref: string } | undefined {
  // The stories' own shots (measured specs): the sets are built from them, so they are the incoming version.
  const shot = (shots?.manifest.components[c.componentId] ?? shots?.manifest.components[c.name])?.variants[key];
  if (shot && 'file' in shot) return { path: shots!.dir ? `${shots!.dir}/${shot.file}` : shot.file, ref: shots!.ref ?? branch };
  // Published code images: made each time a change ships, of the code version they name.
  const entry = refs?.components[c.componentId];
  const ref = entry?.variants[key];
  if (entry && ref && 'file' in ref && entry.specHash === (c.codeHash || c.hash)) return { path: `${FIGMA_REFERENCES_DIR}/${ref.file}`, ref: FIGMA_REFERENCES_BRANCH };
  return undefined;
}

/** The preview of one set, as the review row shows it. */
export interface UpdatePreview {
  key: string;
  /** The Figma render of that variant now (base64 PNG). */
  before?: string | undefined;
  /** The incoming version: in code (an image of the code), or drawn by Bridge off-canvas. */
  after?: string | undefined;
  source: 'code' | 'bridge' | 'none';
  /** `waiting`: drawn by Bridge once its row scrolls into view. */
  state: 'waiting' | 'loading' | 'done';
  /** Drawn by Bridge: how long the drawing took (for developers, and to tune the cap). */
  ms?: number | undefined;
}

/** How long a drawing by Bridge may take before the preview falls back to the list of changes. */
export const RENDER_CAP_MS = 8000;

export const PREVIEW_WORDS = {
  before: 'Before: in Figma now',
  afterCode: 'After: in code',
  afterBridge: 'After: drawn by Bridge',
  close: 'Figma gets as close to this as Bridge can draw it.',
  loading: 'Getting the new version',
} as const;
