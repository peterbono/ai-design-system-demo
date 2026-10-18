// Frames of real components for Studio previews: the token popover (live while picking), the draft review and the
// Components drawer. A frame clones the build-time samples (EditorPreview.tsx, a <template data-xe-samples>), sets
// the theme, brand and density on itself, paints CSS variable overrides inline, and scales its content to fill the
// frame (lib/preview-fit.ts). Frames are inert: they show, they do not take focus.
import { fitScale } from '../../lib/preview-fit';

export interface FrameContext {
  brand: string;
  theme: string;
  density: string;
}

/** The sample template on the page, or null (the explorer in read mode has none). */
export const sampleTemplate = () => document.querySelector<HTMLTemplateElement>('template[data-xe-samples]');

/** Names of every sample the template holds. */
export function sampleNames(tpl: HTMLTemplateElement | null): string[] {
  return tpl ? [...tpl.content.querySelectorAll<HTMLElement>('[data-sample]')].map((x) => x.dataset.sample!) : [];
}

/** One frame: the named samples on `stage` (a CSS background), in `ctx`, with `overrides` as inline variables. */
export function sampleFrame(tpl: HTMLTemplateElement, names: string[], ctx: FrameContext, overrides: Record<string, string> = {}, stage = 'var(--color-bg-default)'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'xe-frame';
  el.dataset.theme = ctx.theme;
  el.dataset.brand = ctx.brand;
  el.dataset.density = ctx.density;
  el.style.setProperty('--xe-stage', stage);
  for (const [k, v] of Object.entries(overrides)) el.style.setProperty(k, v);
  const fit = document.createElement('div');
  fit.className = 'xe-fit';
  for (const n of names) {
    const s = tpl.content.querySelector(`[data-sample="${CSS.escape(n)}"]`);
    if (s) fit.append(s.cloneNode(true));
  }
  el.append(fit);
  el.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
  el.querySelectorAll('input, button, a, select, textarea, [tabindex]').forEach((x) => x.setAttribute('tabindex', '-1'));
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Scales the content of every frame under `root` to fill it. Call once the frames are in the page and visible. */
export function fitFrames(root: ParentNode, opts: { max?: number } = {}) {
  for (const frame of root.querySelectorAll<HTMLElement>('.xe-frame, [data-fit-frame]')) {
    const inner = frame.querySelector<HTMLElement>(':scope > .xe-fit, :scope > [data-fit]');
    if (!inner) continue;
    const pad = parseFloat(getComputedStyle(frame).paddingLeft) || 0;
    const scale = fitScale({ width: inner.offsetWidth, height: inner.offsetHeight }, { width: frame.clientWidth, height: frame.clientHeight }, { max: opts.max ?? 1.25, pad });
    inner.style.setProperty('--xe-scale', String(scale));
  }
}
