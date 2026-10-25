// The Bridge mark in every size clients ask for (public/), linked from every page head, and the icons the MCP server
// declares (packages/mcp SERVER_INFO) are files this site really serves. Claude and favicon services fall back to
// /favicon.ico and PNG icons; a missing one showed another product's logo on the Bridge connector.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_INFO } from '@bridge-ds/mcp';

const SITE = join(__dirname, '../..');
const PUBLIC = join(SITE, 'public');
const file = (p: string) => readFileSync(join(PUBLIC, p));
const pngSize = (b: Buffer) => (b.subarray(1, 4).toString('ascii') === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null);

describe('official icons', () => {
  it('serves every icon the MCP server declares, at the size it says', () => {
    for (const icon of SERVER_INFO.icons) {
      const url = new URL(icon.src);
      expect(url.protocol).toBe('https:');
      const body = file(url.pathname.slice(1));
      if (icon.mimeType === 'image/png') {
        const [w, h] = pngSize(body)!;
        expect(icon.sizes).toEqual([`${w}x${h}`]);
      } else {
        expect(body.toString('utf8')).toMatch(/^<svg /);
      }
    }
  });

  it('has a real favicon.ico (16, 32 and 48) and an apple-touch icon at 180', () => {
    const ico = file('favicon.ico');
    expect(ico.readUInt16LE(2)).toBe(1);
    const n = ico.readUInt16LE(4);
    expect(Array.from({ length: n }, (_, i) => ico.readUInt8(6 + 16 * i))).toEqual([16, 32, 48]);
    expect(pngSize(file('apple-touch-icon.png'))).toEqual([180, 180]);
  });

  it('names the web app Bridge in the manifest, with the 192 and 512 icons', () => {
    const m = JSON.parse(file('site.webmanifest').toString('utf8'));
    expect(m.name).toBe('Bridge');
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual(['/icon-192.png', '/icon-512.png']);
  });

  it('links the icons from every document head', () => {
    for (const page of ['src/layouts/Layout.astro', 'src/layouts/Landing.astro', 'src/pages/studio/components/docs/[slug].astro']) {
      expect(readFileSync(join(SITE, page), 'utf8'), page).toContain('<SiteIcons />');
    }
    const icons = readFileSync(join(SITE, 'src/components/site/SiteIcons.astro'), 'utf8');
    for (const href of ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/site.webmanifest']) expect(icons).toContain(`href="${href}"`);
    expect(readFileSync(join(SITE, 'api/mcp/index.ts'), 'utf8')).toContain('<link rel="icon" href="/favicon.ico"');
  });
});
