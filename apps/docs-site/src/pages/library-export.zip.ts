// "Export the docs" (Library home): every Library doc page as Markdown plus an index.md, one zip built with the site
// (lib/library/confluence/site.ts). Static: no runtime cost.
import type { APIRoute } from 'astro';
import { siteExportZip } from '../lib/library/confluence/site';

export const GET: APIRoute = () => new Response(siteExportZip(), { headers: { 'Content-Type': 'application/zip' } });
