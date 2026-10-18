// Component previews in Studio (token popover, draft review, component list and drawer): which real components to
// show and how much to scale them so they fill their frame. Pure, tested in preview-fit.test.ts.

export interface Size {
  width: number;
  height: number;
}

/**
 * Scale that fits `content` inside `box` (minus `pad` on each side), never above `max`: small components grow a
 * little to fill the frame, large ones shrink to stay whole. 1 when a size is unknown (not laid out yet).
 */
export function fitScale(content: Size, box: Size, opts: { max?: number; pad?: number } = {}): number {
  const max = opts.max ?? 1.25;
  const pad = opts.pad ?? 0;
  const w = box.width - pad * 2;
  const h = box.height - pad * 2;
  if (content.width <= 0 || content.height <= 0 || w <= 0 || h <= 0) return 1;
  const s = Math.min(w / content.width, h / content.height, max);
  return Math.round(s * 1000) / 1000;
}

/**
 * Components to preview for a token: the ones that use it and have a sample, in order, at most `max`. When none
 * has a sample, the fallback set (rendered on the page canvas, said so by the caller).
 */
export function previewSamples(using: string[], available: string[], opts: { max?: number; fallback?: string[] } = {}): { names: string[]; usesToken: boolean } {
  const max = opts.max ?? 4;
  const have = new Set(available);
  const picked = [...new Set(using)].filter((n) => have.has(n)).slice(0, max);
  if (picked.length) return { names: picked, usesToken: true };
  return { names: (opts.fallback ?? []).filter((n) => have.has(n)).slice(0, max), usesToken: false };
}
