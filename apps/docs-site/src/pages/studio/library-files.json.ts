import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { tokenFiles } from '../../lib/explorer';
import { COMPONENTS_DIR, componentTokenIndex, loadComponents } from '../../lib/components';
import { exists, readText } from '../../lib/repo';
import { siteRepo } from '../../lib/config';
import { gitBlobSha } from '../../lib/view-scope';

// The latest library as Studio Components reads it to show an open change (lib/view-scope, scripts/view-change):
// this build's token files and config, the tokens each component reads, and the git blob id of each component's
// guidance file (so the page can tell which guidance the change edits without reading it). Fetched only while a
// change is shown; the Tokens page embeds the same token files itself.
export const GET: APIRoute = async () => {
  const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');
  const docs: Record<string, { name: string; path: string; sha: string }> = {};
  for (const c of loadComponents()) if (exists(c.files.docs)) docs[c.slug] = { name: c.name, path: c.files.docs, sha: await gitBlobSha(readText(c.files.docs), sha1) };
  const body = {
    tokensRoot: siteRepo().tokensRoot,
    componentsDir: COMPONENTS_DIR,
    config: exists('bridge.config.json') ? readText('bridge.config.json') : '{}',
    files: tokenFiles(),
    components: componentTokenIndex(),
    docs,
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
