#!/usr/bin/env node
// Serves the Bridge Library as a Claude Design System from the Bridge site, per Library version. The docs-site build
// (npm run docs:build) runs it after Astro, into the site's output folder, so Vercel serves the files as static
// assets: no function, no storage, no extra deploy.
//
//   node scripts/claude-design-system/release.mjs                    into apps/docs-site/dist
//   node scripts/claude-design-system/release.mjs --out <site dir>   e.g. apps/docs-site/public for astro dev
//
// For @bridge-ds/react <version> it writes:
//   <site>/claude-design-system/<version>/project/...         the files a Design System artifact publishes
//   <site>/claude-design-system/<version>/manifest.json       path, size and sha256 of each (lib.mjs buildManifest)
//   <site>/claude-design-system/manifest.json                 the same manifest: the version this deploy serves
// The Bridge MCP tool bridge_get_claude_design_system reads the latest manifest and hands it to the team's Claude,
// which creates the artifact once and then republishes only the files whose sha256 changed.
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './build.mjs';
import { SERVE_DIR, buildManifest } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function release({ siteDir }) {
  const serveDir = join(siteDir, SERVE_DIR);
  rmSync(serveDir, { recursive: true, force: true });
  const { version } = JSON.parse(readFileSync(join(ROOT, 'packages/react/package.json'), 'utf8'));
  const versionDir = join(serveDir, version);
  const r = await generate({ outDir: versionDir });
  const manifest = buildManifest({ files: r.files, version: r.version, revision: r.commit, sha256 });
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(versionDir, 'manifest.json'), text);
  writeFileSync(join(serveDir, 'manifest.json'), text);
  return { manifest, versionDir };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const siteDir = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'apps/docs-site/dist');
  const { manifest, versionDir } = await release({ siteDir });
  const big = manifest.files.filter((f) => f.size > 15 * 1024 * 1024);
  if (big.length) {
    console.error(`claude-ds release: over the 15 MiB file cap: ${big.map((f) => f.path).join(', ')}`);
    process.exit(1);
  }
  console.log(`claude-ds release: ${manifest.name} ${manifest.version} (${manifest.revision}), ${manifest.count} files, ${(manifest.bytes / 1024).toFixed(0)} kB in ${relative(process.cwd(), versionDir) || versionDir}`);
}
