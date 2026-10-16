// Side-by-side composite (before | after | diff) with labels and changed regions outlined, rendered by the
// same headless Chrome that took the screenshots, so no image or font library is needed.
import { readFile, writeFile } from 'node:fs/promises';
import type { Page } from 'playwright-core';
import type { Box } from './types.js';

export interface CompositeInput {
  title: string;
  subtitle: string;
  before: string | null;
  after: string | null;
  diff: string | null;
  width: number;
  height: number;
  boxes: Box[];
  out: string;
  /** Column width in CSS px; images wider than this are scaled down. */
  column?: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function composite(page: Page, c: CompositeInput): Promise<void> {
  const col = Math.min(c.column ?? 520, c.width);
  const k = col / c.width;
  const h = Math.round(c.height * k);
  const img = async (p: string | null) => (p ? `data:image/png;base64,${(await readFile(p)).toString('base64')}` : null);
  const [b, a, d] = await Promise.all([img(c.before), img(c.after), img(c.diff)]);
  const boxes = c.boxes
    .map((x) => `<i style="left:${x.x * k - 2}px;top:${x.y * k - 2}px;width:${x.width * k + 4}px;height:${x.height * k + 4}px"></i>`)
    .join('');
  // Zoom on the largest changed region at up to 2x, so a one-shade color change is visible in the comment.
  const big = [...c.boxes].sort((p, q) => q.width * q.height - p.width * p.height)[0];
  let zoomRow = '';
  if (big && c.boxes.length && big.width * big.height < c.width * c.height * 0.5) {
    const pad = 24;
    const z = Math.min(2, col / Math.min(c.width, big.width + pad * 2));
    // Source window that fills the column at zoom z, centered on the change.
    const w = Math.min(c.width, col / z);
    const hh = Math.min(c.height, Math.max(big.height + pad * 2, 100), 360 / z);
    const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
    const x = clamp(big.x + big.width / 2 - w / 2, c.width - w);
    const y = clamp(big.y + big.height / 2 - hh / 2, c.height - hh);
    const crop = (label: string, src: string | null) =>
      `<figure><figcaption>${label}</figcaption><div class="frame" style="width:${col}px;height:${Math.round(hh * z)}px">${
        src ? `<div style="width:${Math.round(w * z)}px;height:${Math.round(hh * z)}px;background:url(${src}) ${-x * z}px ${-y * z}px / ${c.width * z}px ${c.height * z}px no-repeat;image-rendering:pixelated"></div>` : ''
      }</div></figure>`;
    zoomRow = `<div class="row zoom">${crop(`Before, zoom ${z.toFixed(1)}x`, b)}${crop('After', a)}${crop('Diff', d)}</div>`;
  }
  const panel = (label: string, src: string | null, withBoxes: boolean) =>
    `<figure><figcaption>${label}</figcaption><div class="frame" style="width:${col}px;height:${h}px">${src ? `<img src="${src}" width="${col}" height="${h}">` : '<span class="none">Not present</span>'}${withBoxes ? boxes : ''}</div></figure>`;
  await page.setContent(
    `<!doctype html><html><head><style>
      *{box-sizing:border-box;margin:0}
      body{background:#f4f4f5;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#18181b;padding:16px;display:inline-block}
      header{display:flex;justify-content:space-between;align-items:baseline;gap:24px;margin-bottom:12px}
      h1{font-size:16px;font-weight:600}
      p{color:#52525b;font-variant-numeric:tabular-nums}
      .row{display:flex;gap:12px}
      .zoom{margin-top:12px}
      figcaption{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#52525b;margin-bottom:6px}
      .frame{position:relative;background:#fff;outline:1px solid #d4d4d8;overflow:hidden}
      .frame img{display:block}
      .frame i{position:absolute;border:2px solid #e5143c;border-radius:3px}
      .none{position:absolute;inset:0;display:grid;place-items:center;color:#71717a}
    </style></head><body><div id="c"><header><h1>${esc(c.title)}</h1><p>${esc(c.subtitle)}</p></header><div class="row">${panel('Before', b, false)}${panel('After', a, true)}${panel('Diff', d, true)}</div>${zoomRow}</div></body></html>`,
    { waitUntil: 'load' },
  );
  const buf = await page.locator('body').screenshot({ animations: 'disabled', scale: 'css' });
  await writeFile(c.out, buf);
}
