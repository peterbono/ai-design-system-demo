// One Library doc page for "Copy for Confluence" (scripts/confluence-copy.ts): { title, html, markdown }, rendered at
// build time from the page model (lib/library/confluence/), so a copy costs one small static file and no runtime.
import type { APIRoute, GetStaticPaths } from 'astro';
import { confluenceKey } from '../../lib/library/confluence/render';
import { siteCopy, siteDocPages } from '../../lib/library/confluence/site';

export const getStaticPaths: GetStaticPaths = () => siteDocPages().pages.map((p) => ({ params: { page: confluenceKey(p.route) } }));

export const GET: APIRoute = ({ params }) => {
  const copy = siteCopy(String(params.page));
  if (!copy) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(copy), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
