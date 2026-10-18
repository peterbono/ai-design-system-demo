// /docs-ai/<slug>.json: what Claude needs to draft a component's docs in place on its Library page (the facts from
// the code and the repo conventions, see docsAiContext). Static, built with the site; read by src/scripts/docs-ai.ts.
import type { APIRoute } from 'astro';
import { loadComponents, type ComponentInfo } from '../../lib/components';
import { docsAiContext } from '../../lib/docs-prefill';

export function getStaticPaths() {
  return loadComponents().map((c) => ({ params: { slug: c.slug }, props: { c } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(docsAiContext((props as { c: ComponentInfo }).c)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
