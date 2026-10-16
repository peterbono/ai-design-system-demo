import type { APIRoute } from 'astro';
import { readText } from '../lib/repo';

// The built tokens of this checkout at a stable URL (`/tokens.css`). A product staging previews a design system
// branch by pointing `?bridge-tokens=` at this file on the branch's docs preview (docs/PREVIEWS.md).
export const GET: APIRoute = () => new Response(readText('packages/tokens/dist/tokens.css'), { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
