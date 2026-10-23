#!/usr/bin/env node
// Local data of `npm run dev:full` (dev/local-api.ts):
//   node dev/cli.mjs reset                          clears .bridge-local (accounts, teams, codes, outbox, secret)
//   node dev/cli.mjs seed <email> <owner/repo> [name] makes <email> an email member ("Can edit") of that team
// Works while the dev server runs: it reads the file again when it changes.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const [cmd, ...args] = process.argv.slice(2);

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  console.error('Bridge local mode refuses to run with NODE_ENV=production or on Vercel.');
  process.exit(1);
}

if (cmd === 'reset') {
  rmSync(join(root, '.bridge-local'), { recursive: true, force: true });
  console.log('Local data cleared (.bridge-local). The next npm run dev:full starts empty.');
} else if (cmd === 'seed') {
  const [email, repo, name] = args;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !repo || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    console.error('Usage: npm run dev:seed -- <email> <owner/repo> [name]');
    process.exit(1);
  }
  const { module: local } = await runnerImport(fileURLToPath(new URL('./local-api.ts', import.meta.url)), { configFile: false, root, logLevel: 'silent' });
  const redis = local.fileRedis(join(local.localDir(root), 'redis.json'));
  const m = await local.seedMember(redis, repo, email, name);
  console.log(`${m.email} is now a member of ${repo.toLowerCase()} (Can edit). Sign in with that email to land on the team.`);
} else {
  console.error('Usage: node dev/cli.mjs reset | seed <email> <owner/repo> [name]');
  process.exit(1);
}
