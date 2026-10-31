// Bridge's own Library for Confluence, at build time: every doc page rendered once (pages/confluence/[page].json.ts
// serves each to the "Copy for Confluence" button) and the "Export the docs" zip (pages/library-export.zip.ts).
// Node only (zlib).
import { deflateRawSync } from 'node:zlib';
import { siteComponentExtras, siteLibraryData } from '../../library-site';
import { exportPath, indexDocPage, libraryDocPages } from './pages';
import { confluenceKey, toConfluenceHtml, toMarkdown, type DocPage, type RenderOptions } from './render';
import { zipFiles } from './zip';

/** The public address links point to: the build's site (a preview's own URL), else the production domain. */
export const PUBLIC_ORIGIN = 'https://bridge.floriangouloubi.com';

let cached: { pages: DocPage[]; options: RenderOptions } | undefined;

export function siteDocPages(): { pages: DocPage[]; options: RenderOptions } {
  if (cached) return cached;
  const site = (import.meta as { env?: { SITE?: string } }).env?.SITE || PUBLIC_ORIGIN;
  const options = { origin: site.replace(/\/$/, ''), date: new Date().toISOString().slice(0, 10) };
  cached = { pages: libraryDocPages(siteLibraryData(siteComponentExtras())), options };
  return cached;
}

/** One page for the copy button: the Confluence HTML and the Markdown fallback. */
export function siteCopy(key: string): { title: string; html: string; markdown: string } | null {
  const { pages, options } = siteDocPages();
  const page = pages.find((p) => confluenceKey(p.route) === key);
  return page ? { title: page.title, html: toConfluenceHtml(page, options), markdown: toMarkdown(page, options) } : null;
}

/** The export: index.md and one Markdown file per page, deflated. */
export function siteExportZip(): Uint8Array<ArrayBuffer> {
  const { pages, options } = siteDocPages();
  const enc = new TextEncoder();
  const index = indexDocPage(siteLibraryData(), pages);
  const entries = [index, ...pages].map((p, i) => ({ path: i === 0 ? 'index.md' : exportPath(p), data: enc.encode(toMarkdown(p, options)) }));
  return zipFiles(entries, { day: options.date, deflate: (d) => new Uint8Array(deflateRawSync(d, { level: 9 })) });
}
