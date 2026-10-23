#!/usr/bin/env node
// Local data of `npm run dev:full` (dev/local-api.ts):
//   node dev/cli.mjs reset                          clears .bridge-local (accounts, teams, codes, outbox, secret)
//   node dev/cli.mjs seed <email> <owner/repo> [name] makes <email> an email member ("Can edit") of that team
//   node dev/cli.mjs scenario <name>                clears local accounts, teams, codes and outbox, then writes one
//                                                   audit scenario (dev/scenarios.ts); `scenario list` lists them
// Works while the dev server runs: it reads the file again when it changes.
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
} else if (cmd === 'scenario') {
  const load = (file) => runnerImport(fileURLToPath(new URL(file, import.meta.url)), { configFile: false, root, logLevel: 'silent' }).then((r) => r.module);
  const sc = await load('./scenarios.ts');
  const [name] = args;
  if (!name || name === 'list') {
    console.log('Audit scenarios (npm run dev:scenario <name>, name like S3, 3 or domain-one):\n');
    for (const s of sc.SCENARIOS) console.log(`  ${s.id.padEnd(4)} ${s.slug.padEnd(22)} ${s.title}`);
    process.exit(name ? 0 : 1);
  }
  const scenario = sc.findScenario(name);
  if (!scenario) {
    console.error(`No scenario "${name}". npm run dev:scenario list shows them.`);
    process.exit(1);
  }
  const local = await load('./local-api.ts');
  const { memoryRedis } = await load('../api/_lib/redis.ts');
  const dir = local.localDir(root);
  const hadSecret = existsSync(join(dir, 'session-secret'));
  const secret = local.sessionSecret(dir);
  const origin = (process.env.BRIDGE_LOCAL_ORIGIN || 'http://localhost:4321').replace(/\/+$/, '');
  // A fresh store and outbox: the scenario is written in memory, then saved at once (a running server reads it).
  rmSync(join(dir, 'outbox.json'), { force: true });
  const outbox = local.outboxSender(join(dir, 'outbox.json'), () => {});
  const redis = memoryRedis();
  const result = await scenario.run({ redis, now: Date.now(), outbox, origin, secret });
  const file = join(dir, 'redis.json');
  writeFileSync(`${file}.tmp`, `${JSON.stringify(redis.snapshot(), null, 1)}\n`);
  renameSync(`${file}.tmp`, file);
  console.log(sc.describeResult(scenario, result, origin));
  if (!hadSecret) console.log('\nA new session secret was made: restart npm run dev:full if it was already running.');
} else {
  console.error('Usage: node dev/cli.mjs reset | seed <email> <owner/repo> [name] | scenario <name> | scenario list');
  process.exit(1);
}
