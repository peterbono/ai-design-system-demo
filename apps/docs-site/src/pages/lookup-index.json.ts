import type { APIRoute } from 'astro';
import { lookupIndex } from '../lib/lookup';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(lookupIndex()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
