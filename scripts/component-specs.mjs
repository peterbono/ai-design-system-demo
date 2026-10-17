#!/usr/bin/env node
// Writes packages/react/component-specs.json: the component specs (variant axes, properties, parts and the token behind
// every fill, stroke, radius, padding, gap, size and text property) the DS Bridge Figma plugin pulls as component sets.
// Derived from the component TSX and CSS modules by @bridge-ds/core/node (component-specs.ts). Never edit the JSON.
//
//   npm run specs            regenerate the file
//   npm run specs -- --check exit 1 when the committed file is out of date (the core test suite checks it too)
//   npm run specs -- Button  print one spec instead of writing the file
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/react/component-specs.json');
const args = process.argv.slice(2);
const check = args.includes('--check');
const only = args.filter((a) => !a.startsWith('-'));

// @bridge-ds/core ships TypeScript sources: bundle the generator once, run it, throw the bundle away.
// Inside node_modules so `typescript` (left external) resolves from the repo.
const dir = join(ROOT, 'node_modules/.cache/bridge-specs');
mkdirSync(dir, { recursive: true });
const outfile = join(dir, `specs-${process.pid}.mjs`);
try {
  await esbuild.build({
    stdin: {
      contents: "export * from '@bridge-ds/core/node';",
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    conditions: ['source'],
    external: ['typescript'],
    outfile,
    logLevel: 'warning',
  });
  const { generateRepoComponentSpecs, serializeComponentSpecs, SPEC_COMPONENTS } = await import(pathToFileURL(outfile).href);
  if (only.length) {
    const file = generateRepoComponentSpecs(ROOT, only);
    console.log(JSON.stringify(file.components, null, 2));
  } else {
    const text = serializeComponentSpecs(generateRepoComponentSpecs(ROOT, SPEC_COMPONENTS));
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch {
      /* first run */
    }
    if (check) {
      if (current !== text) {
        console.error('packages/react/component-specs.json is out of date. Run `npm run specs` and commit the result.');
        process.exit(1);
      }
      console.log('component-specs.json is up to date.');
    } else {
      writeFileSync(OUT, text);
      console.log(`Wrote packages/react/component-specs.json (${SPEC_COMPONENTS.join(', ')}).`);
    }
  }
} finally {
  rmSync(outfile, { force: true });
}
