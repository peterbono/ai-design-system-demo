import type { APIRoute } from 'astro';
import { historyData } from '../../lib/history';

// Real history, demo history (kept apart) and the current token files, for the History page and the token panel.
export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await historyData()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
