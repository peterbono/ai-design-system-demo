// Code images for the fidelity check: which code render matches each generated Figma variant, and where the images
// live. The generator (component-specs.ts) draws one Figma variant per axis combination; this module turns that same
// spec back into props, content and a pseudo state, so the hidden Storybook story "Internal/Figma reference" renders
// what the Figma variant should look like (same texts, icons and width). A variant that cannot be rendered the same
// way is skipped with a reason, never guessed.
//
// Images are made on main by .github/workflows/figma-references.yml (bridge figma-references) and published to the
// `bridge-visual` branch, the one Visual impact already publishes to, under figma-references/: manifest.json plus one
// PNG per variant. The plugin reads them through the GitHub contents API with the token it already has.

import { variantKeyOf, type ComponentSpec, type ComponentSpecsFile, type SpecPart, type SpecVariant } from './component-spec';

export const FIGMA_REFERENCES_BRANCH = 'bridge-visual';
export const FIGMA_REFERENCES_DIR = 'figma-references';
export const FIGMA_REFERENCES_MANIFEST = `${FIGMA_REFERENCES_DIR}/manifest.json`;
/** Story id of packages/react/src/stories/FigmaReference.stories.tsx. */
export const FIGMA_REFERENCE_STORY = 'internal-figma-reference--variant';
/** Width token of a block-level root in Figma (the plugin draws fill roots at this width: FILL_WIDTH_TOKEN). */
export const FIGMA_FILL_WIDTH_TOKEN = 'size.80';

export type ReferencePseudo = 'hover' | 'active' | 'focus-visible';

/** What the reference story renders for one variant. JSON, passed to the story as a string arg. */
export interface ReferenceRender {
  /** Export name of the component ("Button", "Card"). */
  component: string;
  /** Props from the variant axes and the default property values ("variant": "primary", "disabled": true). */
  props: Record<string, string | boolean>;
  /** Text children (the Label property) of a simple component. */
  text?: string | undefined;
  /** Compound parts, in order: export name and text ("CardHeader", "Header"). */
  parts?: { component: string; text: string }[] | undefined;
  /** Icon props -> Lucide icon name ("icon": "Pencil"). */
  icons?: Record<string, string> | undefined;
  /** Hover, pressed or focus, forced with the pseudo-states addon classes. */
  pseudo?: ReferencePseudo | undefined;
  /** Width token path of the frame the component sits in, for roots that fill their container. */
  width?: string | undefined;
}

export type ReferencePlan = { ok: true; render: ReferenceRender } | { ok: false; reason: string };

const STATE_PSEUDO: Record<string, ReferencePseudo | 'rest' | 'disabled'> = {
  default: 'rest',
  rest: 'rest',
  enabled: 'rest',
  hover: 'hover',
  hovered: 'hover',
  pressed: 'active',
  active: 'active',
  focus: 'focus-visible',
  focused: 'focus-visible',
  'focus visible': 'focus-visible',
  disabled: 'disabled',
};

const iconName = (component: string) => component.replace(/^Icon\//, '');
const exportName = (name: string) => name.replace(/[^A-Za-z0-9]+/g, '');

/** How to render one generated variant from code, or why it cannot be compared. */
export function planReference(spec: ComponentSpec, variant: SpecVariant, file?: Pick<ComponentSpecsFile, 'slots'>): ReferencePlan {
  // A popup drawn open: the code image shows the component closed, so there is nothing to compare it with.
  if (spec.view === 'popup') return { ok: false, reason: 'drawn open in Figma; the code image shows it closed' };
  const props: Record<string, string | boolean> = { ...(spec.fixed ?? {}) };
  let pseudo: ReferencePseudo | undefined;
  for (const axis of spec.axes) {
    const value = variant.props[axis.name];
    if (value === undefined) return { ok: false, reason: `the variant has no ${axis.name} value` };
    if (axis.prop) {
      props[axis.prop] = value === 'true' ? true : value === 'false' ? false : value;
      continue;
    }
    // The Checked axis the generator draws from Base UI's checked state: the checked and indeterminate props.
    if (axis.name === 'Checked') {
      props.checked = value === 'true';
      if (value === 'mixed') props.indeterminate = true;
      continue;
    }
    if (axis.name.toLowerCase() !== 'state') return { ok: false, reason: `${axis.name} has no matching option in code` };
    const s = STATE_PSEUDO[value.toLowerCase()];
    if (!s) return { ok: false, reason: `the ${value} state has no code equivalent to render` };
    if (s === 'disabled') props.disabled = true;
    else if (s !== 'rest') pseudo = s;
  }

  const root = spec.parts.find((p) => !p.parent);
  if (!root) return { ok: false, reason: 'the spec has no root layer' };
  const children = (id: string) => spec.parts.filter((p) => p.parent === id);
  const textOf = (part: SpecPart): string | { reason: string } => {
    const swapTo = variant.slots?.[part.id] ?? part.swap?.default;
    if (part.swap && swapTo) {
      const slot = file?.slots?.find((s) => s.name === swapTo);
      if (!slot) return { reason: `${swapTo} is not in the specs` };
      if (slot.kind !== 'text' || !slot.text) return { reason: `Figma shows a placeholder (${swapTo}) that code has no example of` };
      return slot.text.default;
    }
    const prop = spec.properties.find((p) => p.name === part.text && p.type === 'TEXT');
    return typeof prop?.default === 'string' ? prop.default : part.name;
  };

  let text: string | undefined;
  const icons: Record<string, string> = {};
  for (const prop of spec.properties) {
    if (prop.type === 'TEXT') {
      // Optional content hidden by default (an input's prefix, a description): not passed, as Figma does not show it.
      const hidden = spec.properties.some((b) => b.type === 'BOOLEAN' && b.prop === prop.prop && b.default === false);
      if (hidden && prop.prop) continue;
      if (prop.prop === 'children') text = String(prop.default);
      else if (prop.prop) props[prop.prop] = String(prop.default);
      continue;
    }
    // BOOLEAN: an optional icon shown by default gets its icon below; any other default-on flag is a prop.
    const iconPart = spec.parts.find((p) => p.kind === 'icon' && p.visible === prop.name);
    if (prop.default === true && !iconPart && prop.prop) props[prop.prop] = true;
  }

  for (const part of spec.parts) {
    if (part.kind !== 'icon' || !part.swap) continue;
    const shown = part.visible ? spec.properties.find((p) => p.name === part.visible)?.default === true : true;
    if (!shown) continue;
    if (!part.swap.prop) return { ok: false, reason: `the ${part.name} icon has no matching option in code` };
    icons[part.swap.prop] = iconName(variant.slots?.[part.id] ?? part.swap.default);
  }

  // Texts that no prop carries: an input's placeholder, or a compound component's parts (CardHeader...).
  let parts: { component: string; text: string }[] | undefined;
  const loose = spec.properties.filter((p) => p.type === 'TEXT' && !p.prop);
  const frames = children(root.id).filter((p) => p.kind === 'frame');
  // Compound parts are frames named like their text (CardHeader's "Header") or holding a slot, not a field's box.
  const compound = text === undefined && frames.length > 0 && frames.every((f) => spec.parts.some((p) => p.parent === f.id && p.kind === 'text' && (p.swap || p.text === f.name)));
  if (compound) {
    parts = [];
    for (const f of frames) {
      const t = spec.parts.find((p) => p.parent === f.id && p.kind === 'text')!;
      const value = textOf(t);
      if (typeof value !== 'string') return { ok: false, reason: value.reason };
      parts.push({ component: `${exportName(spec.name)}${exportName(f.name)}`, text: value });
    }
  }
  for (const p of loose) {
    // A value display Base UI writes from the component's value (a progress percentage): code writes it too.
    if (p.name === 'Value') continue;
    const part = spec.parts.find((x) => x.text === p.name);
    if (compound && part && part.parent !== root.id) continue;
    if (part && /placeholder$/.test(part.id)) {
      props.placeholder = String(p.default);
      continue;
    }
    return { ok: false, reason: `the ${p.name} text has no matching option in code` };
  }

  return {
    ok: true,
    render: {
      component: exportName(spec.view || spec.fixed ? (spec.component ?? spec.name) : spec.name),
      props,
      ...(text !== undefined ? { text } : {}),
      ...(parts ? { parts } : {}),
      ...(Object.keys(icons).length ? { icons } : {}),
      ...(pseudo ? { pseudo } : {}),
      ...(root.fill ? { width: FIGMA_FILL_WIDTH_TOKEN } : {}),
    },
  };
}

/** File name of a variant's image, stable and file safe: "button/size-md__state-default__variant-primary.png". */
export function referenceImagePath(component: string, key: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = key
    .split(',')
    .map((kv) => slug(kv))
    .filter(Boolean)
    .join('__');
  return `${slug(component)}/${file || 'default'}.png`;
}

export type FigmaReferenceEntry = { file: string; width: number; height: number } | { skipped: string };

export interface FigmaReferenceManifest {
  version: 1;
  tool: '@bridge-ds/visual';
  createdAt: string;
  /** Commit of the code the images were made from. */
  sha: string;
  /** Device pixels per CSS pixel, the scale the plugin exports Figma variants at. */
  scale: number;
  mode: { brand: string; theme: string; density: string };
  storyId: string;
  components: Record<string, { specHash: string; variants: Record<string, FigmaReferenceEntry> }>;
}

/** Every variant of every spec with its render plan (the capture's to-do list). */
export function planReferences(file: ComponentSpecsFile): { component: string; specHash: string; key: string; plan: ReferencePlan }[] {
  return file.components.flatMap((spec) =>
    spec.variants.map((v) => ({ component: spec.name, specHash: spec.hash, key: variantKeyOf(v.props), plan: planReference(spec, v, file) })),
  );
}
