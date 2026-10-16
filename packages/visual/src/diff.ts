// Pixel diff: pixelmatch over two PNGs padded to the same size, plus the bounding boxes of what changed.
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Box } from './types.js';

export interface DiffResult {
  changedPixels: number;
  totalPixels: number;
  percent: number;
  boxes: Box[];
  /** Diff image: the after image faded, changed pixels in red. Null when nothing changed. */
  diff: PNG | null;
  width: number;
  height: number;
}

export const decodePng = (buf: Buffer): PNG => PNG.sync.read(buf);
export const encodePng = (png: PNG): Buffer => PNG.sync.write(png, { colorType: 6 });

/** Copies `src` onto a `width` x `height` canvas filled with an opaque neutral, so sizes can differ. */
export function padTo(src: PNG, width: number, height: number): PNG {
  if (src.width === width && src.height === height) return src;
  const out = new PNG({ width, height });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 255;
    out.data[i + 1] = 0;
    out.data[i + 2] = 255;
    out.data[i + 3] = 255;
  }
  PNG.bitblt(src, out, 0, 0, Math.min(src.width, width), Math.min(src.height, height), 0, 0);
  return out;
}

/**
 * Compares two screenshots. `threshold` is pixelmatch's per-pixel color distance (0..1, 0.03 by default: low enough to catch one step of a color ramp);
 * anti-aliasing differences are ignored. Area that exists in only one image (a taller story) counts as changed.
 */
export function diffPngs(before: PNG, after: PNG, threshold = 0.03, cell = 16): DiffResult {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const a = padTo(before, width, height);
  const b = padTo(after, width, height);
  const out = new PNG({ width, height });
  const changedPixels = pixelmatch(a.data, b.data, out.data, width, height, { threshold, includeAA: false, alpha: 0.15, diffColor: [229, 20, 60], diffColorAlt: [229, 20, 60] });
  const totalPixels = width * height;
  const percent = totalPixels ? Math.round((changedPixels / totalPixels) * 10000) / 100 : 0;
  const boxes = changedPixels ? boxesFromDiff(out, cell) : [];
  return { changedPixels, totalPixels, percent: changedPixels && percent === 0 ? 0.01 : percent, boxes, diff: changedPixels ? out : null, width, height };
}

const isDiffPixel = (d: Buffer, i: number) => d[i] === 229 && d[i + 1] === 20 && d[i + 2] === 60;

/**
 * Bounding boxes of changed regions: the diff mask is bucketed into `cell` px cells, neighbouring cells
 * (8-connected, one empty cell of slack) are merged, and each group gives one box. At most `max` boxes;
 * beyond that the smallest are merged into their nearest neighbour.
 */
export function boxesFromDiff(diff: PNG, cell = 16, max = 12): Box[] {
  const cols = Math.ceil(diff.width / cell);
  const rows = Math.ceil(diff.height / cell);
  const hot = new Uint8Array(cols * rows);
  for (let y = 0; y < diff.height; y++) {
    for (let x = 0; x < diff.width; x++) {
      if (isDiffPixel(diff.data, (y * diff.width + x) * 4)) hot[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
    }
  }
  return boxesFromCells(hot, cols, rows, cell, diff.width, diff.height, max);
}

export function boxesFromCells(hot: Uint8Array, cols: number, rows: number, cell: number, width: number, height: number, max = 12): Box[] {
  const seen = new Uint8Array(cols * rows);
  let boxes: Box[] = [];
  for (let i = 0; i < hot.length; i++) {
    if (!hot[i] || seen[i]) continue;
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const cx = j % cols;
      const cy = (j - cx) / cols;
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const k = ny * cols + nx;
          if (hot[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
    boxes.push({ x: x0 * cell, y: y0 * cell, width: Math.min((x1 + 1) * cell, width) - x0 * cell, height: Math.min((y1 + 1) * cell, height) - y0 * cell });
  }
  boxes.sort((p, q) => p.y - q.y || p.x - q.x);
  while (boxes.length > max) {
    // Merge the smallest box into the box whose union with it is smallest.
    boxes.sort((p, q) => p.width * p.height - q.width * q.height);
    const s = boxes.shift()!;
    let best = 0;
    let bestArea = Infinity;
    boxes.forEach((b, k) => {
      const u = union(s, b);
      if (u.width * u.height < bestArea) (bestArea = u.width * u.height), (best = k);
    });
    boxes[best] = union(s, boxes[best]!);
    boxes = boxes.sort((p, q) => p.y - q.y || p.x - q.x);
  }
  return boxes;
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
