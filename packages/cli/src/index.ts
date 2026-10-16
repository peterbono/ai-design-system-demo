#!/usr/bin/env node
// bridge: CLI for the Bridge design-system-as-code tools. Small on purpose: Node built-ins + @bridge/mcp.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { originRepo } from '@bridge/core/node';
import { fileURLToPath } from 'node:url';
import { runImpact, type Only } from '@bridge/visual';
import { BridgeContext, CONFIG_FILE, core, detectConfig, GitRefSource, history as hist, LocalSource, ops, optionsFromArgv, serveStdio, toConfigJson, VERSION, type BridgeConfig } from '@bridge/mcp';

const HELP = `bridge ${VERSION}: design system as code, for you and your Claude

Usage:
  bridge init [--force]               write bridge.config.json (detected) and .mcp.json for Claude Code
  bridge check [--json] [--strict]    validate tokens + contrast gate. Exit 0 ok, 1 failures, 2 setup error
  bridge tokens <query> [--json]      search tokens by name, description or value
  bridge diff <base> [--json|--md]    designer-readable token diff: working tree vs <base> (git ref)
  bridge propose --title "..." --set path=value [--set ...] [--file f | --mode theme=dark]
                 [--edits edits.json] [--summary "..."] [--dry-run]
                                      validate + contrast + new local bridge/* branch (never pushes)
  bridge impact [--base main] [--head HEAD] [--out dir] [--only stories|app] [--threshold 0.03]
                 [--plan] [--json] [--image-base url] [--artifact-url url] [--keep-unchanged]
                                      visual impact: build Storybook and the app at both refs, screenshot
                                      what the change touches, pixel-diff, write manifest.json + images.
                                      Exit 0 even with diffs (2 on setup errors). Needs Chrome installed.
  bridge history [token] [--json] [--limit n] [--author a] [--tier n] [--version v]
                                      token history: versions, merged changes, who, when, why
  bridge revert <pr|commit|id> [--dry-run] [--restore-conflicts] [--use-before path@file] [--json]
                                      undo a merged token change against HEAD: conflicts shown,
                                      new local bridge/* branch (never pushes, never main)
  bridge mcp [--root dir | --repo owner/name]   start the MCP server on stdio

Options:
  --root <dir>   repo root (default: current directory)
  GITHUB_TOKEN   env, optional: lets the MCP server open PRs on a remote repo. Never needed for local use.
`;

interface Args {
  _: string[];
  flags: Record<string, string[]>;
}
function parse(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      const takesValue = inline === undefined && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') && !['force', 'json', 'md', 'strict', 'dry-run', 'help', 'plan', 'keep-unchanged', 'restore-conflicts', 'breaking'].includes(k);
      (out.flags[k] ??= []).push(inline ?? (takesValue ? argv[++i]! : 'true'));
    } else out._.push(a);
  }
  return out;
}
const flag = (a: Args, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: Args, k: string) => Boolean(a.flags[k]);
const print = (s: string) => process.stdout.write(`${s}\n`);
const modeArg = (s?: string) => (s ? Object.fromEntries(s.split(',').map((kv) => kv.split('=') as [string, string])) : undefined);

async function init(a: Args, root: string) {
  const cfgPath = join(root, CONFIG_FILE);
  let config: BridgeConfig;
  if (existsSync(cfgPath) && !has(a, 'force')) {
    print(`${CONFIG_FILE} exists, keeping it (--force to regenerate).`);
    config = (await (await BridgeContext.create({ root })).config()).config;
  } else {
    const src = new LocalSource(root);
    const files = await src.list('');
    const repo = await originRepo(root);
    config = await detectConfig(files, (p) => src.read(p), repo ? { repo } : {});
    await writeFile(cfgPath, `${JSON.stringify(toConfigJson(config, 'https://raw.githubusercontent.com/peterbono/ai-design-system-demo/main/packages/core/bridge.config.schema.json'), null, 2)}\n`);
    print(`Wrote ${CONFIG_FILE}: tokens in ${config.tokens.root}, ${config.tokens.layers.length} layers, modes ${Object.keys(config.axes).join(', ') || 'none'}.`);
    print('Check the layers order (lowest first) and the tiers; detection is a starting point.');
  }
  // Server command: the local build of @bridge/mcp (packages are not published to npm yet).
  const serverJs = fileURLToPath(new URL('./index.js', import.meta.resolve('@bridge/mcp')));
  const relServer = relative(root, serverJs);
  const inRepo = !relServer.startsWith('..');
  const mcpPath = join(root, '.mcp.json');
  const existing = existsSync(mcpPath) ? (JSON.parse(await readFile(mcpPath, 'utf8')) as { mcpServers?: Record<string, unknown> }) : {};
  existing.mcpServers = { ...(existing.mcpServers ?? {}), bridge: { command: 'node', args: [inRepo ? relServer : serverJs, '--root', '.'] } };
  await writeFile(mcpPath, `${JSON.stringify(existing, null, 2)}\n`);
  print(`Wrote .mcp.json: Claude Code picks up the "bridge" server next time it starts in ${root}.`);
  print('\nClaude Desktop: add this to claude_desktop_config.json (Settings > Developer > Edit config):');
  print(JSON.stringify({ mcpServers: { bridge: { command: 'node', args: [serverJs, '--root', root] } } }, null, 2));
  print('\nOr with the Claude Code CLI:');
  print(`  claude mcp add bridge -- node ${serverJs} --root ${root}`);
  print('(Once @bridge/mcp is published: claude mcp add bridge -- npx -y @bridge/mcp)');
}

async function check(a: Args, root: string): Promise<number> {
  const ctx = await BridgeContext.create({ root });
  const v = await ops.validateTokens(ctx, { includeWarnings: true });
  const c = await ops.checkContrast(ctx, {});
  const warnings = 'warnings' in v ? (v.warnings ?? []) : [];
  const failed = !v.valid || ('failing' in c && (c.failing ?? 0) > 0) || (has(a, 'strict') && warnings.length > 0);
  if (has(a, 'json')) {
    print(JSON.stringify({ ok: !failed, validation: v, contrast: c }, null, 2));
    return failed ? 1 : 0;
  }
  print(`tokens: ${v.tokens} in ${v.files} files, ${v.modeCombinations} mode combinations`);
  for (const e of v.errors) print(`  error  ${e.code}  ${e.path ?? ''} ${e.file ? `(${e.file})` : ''} ${e.message}${e.modes ? ` [${e.modes.join('; ')}]` : ''}`);
  for (const w of warnings) print(`  warn   ${w.code}  ${w.path ?? ''} ${w.message}`);
  if ('checks' in c) {
    print(`contrast: ${c.checks} checks, ${c.failing} failing`);
    for (const f of c.failures ?? []) print(`  fail   ${f.fg} on ${f.bg} [${f.modes}] ${f.ratio ?? 'n/a'}:1 < ${f.min}:1${f.note ? ` (${f.note})` : ''}`);
    const tight = c.tightest?.[0];
    if (tight) print(`  tightest: ${tight.pair} [${tight.modes}] ${tight.ratio}:1 (min ${tight.min})`);
  } else print(`contrast: ${c.message}`);
  print(failed ? 'FAIL' : 'OK');
  return failed ? 1 : 0;
}

async function tokens(a: Args, root: string) {
  const q = a._.slice(1).join(' ');
  if (!q) throw new UsageError('bridge tokens <query>');
  const ctx = await BridgeContext.create({ root });
  const r = await ops.searchTokens(ctx, { query: q, limit: Number(flag(a, 'limit') ?? 20) });
  if (has(a, 'json')) return print(JSON.stringify(r, null, 2));
  if (!r.results.length) return print(`No token matches "${q}".`);
  const w = Math.max(...r.results.map((x) => x.path.length));
  for (const t of r.results) print(`${t.path.padEnd(w)}  ${String(t.value).padEnd(10)}  ${(t.tier ?? '').padEnd(9)}  ${t.description ?? ''}`);
}

async function diff(a: Args, root: string): Promise<number> {
  const base = a._[1];
  if (!base) throw new UsageError('bridge diff <base>   (a git ref: main, HEAD~1, a sha)');
  const ctx = await BridgeContext.create({ root });
  const { config } = await ctx.config();
  const before = await core.loadTokenSet(new GitRefSource(root, base), config);
  const after = await ctx.tokens();
  const changes = core.diff(before, after);
  const pairs = await core.readContrastPairs(ctx.source, config).catch(() => []);
  const delta = pairs.length ? core.contrastDelta(core.runContrast(before, pairs, config.contrast?.modes), core.runContrast(after, pairs, config.contrast?.modes)) : [];
  const tier = core.classify(changes, [], config);
  const imp = core.impact(before, after, changes, 30);
  if (has(a, 'json')) {
    print(JSON.stringify({ base, changes, contrast: delta, tier, impact: imp }, null, 2));
    return 0;
  }
  if (has(a, 'md')) {
    print(`## Token changes since \`${base}\`\n\n${core.tokenTable(changes)}\n\n## Contrast\n\n${core.contrastTable(delta)}\n\nTier ${tier.tier}, ${tier.bump}: ${tier.reasons.join('; ')}`);
    return 0;
  }
  if (!changes.length) {
    print(`No token changes since ${base}.`);
    return 0;
  }
  print(`${changes.length} token change(s) since ${base}  (Tier ${tier.tier}, ${tier.bump})\n`);
  const sym = { added: '+', removed: '-', changed: '~', renamed: '>' } as const;
  for (const c of changes) {
    const vals = c.kind === 'changed' ? `${c.beforeCss}  ->  ${c.afterCss}${c.fields.includes('description') ? '  (description)' : ''}` : c.kind === 'added' ? c.afterCss : c.kind === 'removed' ? c.beforeCss : `from ${c.from}`;
    print(`  ${sym[c.kind]} ${c.path}  ${vals}   ${c.file}`);
  }
  if (imp.total) {
    print(`\n${imp.total} other token(s) change value through aliases:`);
    for (const e of imp.entries.slice(0, 10)) print(`    ${e.path}  ${e.before} -> ${e.after}  (${e.modes.length} mode${e.modes.length > 1 ? 's' : ''})`);
  }
  if (delta.length) {
    print('\nContrast:');
    for (const d of delta.slice(0, 20)) print(`    ${d.passAfter ? 'ok  ' : 'FAIL'} ${d.fg} on ${d.bg} [${d.modes}]  ${d.before ?? 'n/a'} -> ${d.after ?? 'n/a'} (min ${d.min})`);
  }
  return delta.some((d) => d.passBefore && !d.passAfter) ? 1 : 0;
}

async function propose(a: Args, root: string): Promise<number> {
  const title = flag(a, 'title');
  if (!title) throw new UsageError('bridge propose --title "Darken muted text" --set color.text.muted={palette.neutral.700} --mode theme=light');
  const edits: Record<string, unknown>[] = [];
  const file = flag(a, 'file');
  const mode = modeArg(flag(a, 'mode'));
  for (const s of a.flags.set ?? []) {
    const i = s.indexOf('=');
    if (i < 0) throw new UsageError(`--set needs path=value, got "${s}"`);
    edits.push({ op: 'set', path: s.slice(0, i), value: s.slice(i + 1), ...(file ? { file } : {}), ...(mode ? { mode } : {}) });
  }
  const editsFile = flag(a, 'edits');
  if (editsFile) edits.push(...(JSON.parse(await readFile(resolve(editsFile), 'utf8')) as Record<string, unknown>[]));
  if (!edits.length) throw new UsageError('Give at least one --set path=value or --edits file.json');
  const ctx = await BridgeContext.create({ root });
  const summary = flag(a, 'summary');
  const r = (await ops.proposeTokenChange(ctx, { title, edits: edits as never, ...(summary ? { summary } : {}), dryRun: has(a, 'dry-run') })) as Record<string, unknown>;
  if (has(a, 'json')) print(JSON.stringify(r, null, 2));
  else {
    print(`status: ${r.status}${r.why ? ` (${r.why})` : ''}`);
    if (r.tier) print(`tier ${r.tier}, ${r.bump}`);
    for (const c of (r.changes as { kind: string; path: string; before?: string; after?: string }[]) ?? []) print(`  ${c.kind} ${c.path}: ${c.before ?? ''} -> ${c.after ?? ''}`);
    if (r.branch) print(`branch: ${r.branch}`);
    if (r.next) print(String(r.next));
    if (r.hint) print(String(r.hint));
    if (r.status === 'dry-run') print(`\n${r.prBody}`);
  }
  return r.status === 'blocked' ? 1 : 0;
}

async function impact(a: Args, root: string): Promise<number> {
  const only = (flag(a, 'only') ?? '').split(',').filter(Boolean) as Only[];
  for (const x of only) if (x !== 'stories' && x !== 'app') throw new UsageError(`--only takes stories or app, got "${x}"`);
  const num = (k: string) => (flag(a, k) !== undefined ? Number(flag(a, k)) : undefined);
  const threshold = num('threshold');
  if (threshold !== undefined && !(threshold >= 0 && threshold <= 1)) throw new UsageError('--threshold is between 0 and 1 (pixelmatch color distance)');
  const imageBase = flag(a, 'image-base');
  const artifactUrl = flag(a, 'artifact-url');
  const out = flag(a, 'out');
  const cacheDir = flag(a, 'cache');
  const maxStories = num('max-stories');
  const r = await runImpact({
    root,
    base: flag(a, 'base') ?? 'main',
    head: flag(a, 'head') ?? 'HEAD',
    ...(out ? { out: resolve(out) } : {}),
    ...(only.length ? { only } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    ...(cacheDir ? { cacheDir: resolve(cacheDir) } : {}),
    ...(maxStories ? { maxStoriesPerComponent: maxStories } : {}),
    ...(imageBase !== undefined ? { imageBase } : {}),
    ...(artifactUrl ? { artifactUrl } : {}),
    plan: has(a, 'plan'),
    keepUnchanged: has(a, 'keep-unchanged'),
  });
  if (has(a, 'json')) {
    print(JSON.stringify({ summary: r.summary, manifest: r.manifestPath, comment: r.commentPath ?? null, ...r.manifest.summary, selection: r.manifest.selection }, null, 2));
    return 0;
  }
  const sel = r.manifest.selection;
  if (has(a, 'plan')) {
    print(`Plan ${r.manifest.base.ref} (${r.manifest.base.sha.slice(0, 7)}) -> ${r.manifest.head.ref} (${r.manifest.head.sha.slice(0, 7)})`);
    print(`  tokens changing value: ${sel.tokens.length}${sel.tokens.length ? ` (${sel.tokens.filter((t) => t.kind === 'direct').map((t) => t.path).slice(0, 6).join(', ')})` : ''}`);
    print(`  components: ${sel.components.map((c) => c.id).join(', ') || 'none'}`);
    print(`  stories: ${sel.stories.length}${sel.fallback ? ` (${sel.fallback})` : ''}`);
    print(`  app screens: ${sel.app.include ? 'yes' : 'no'} (${sel.app.reason})`);
    return 0;
  }
  print(r.summary);
  for (const s of r.manifest.shots.filter((x) => x.status !== 'unchanged').slice(0, 30)) print(`  ${s.status.padEnd(9)} ${s.percent.toFixed(2).padStart(6)}%  ${s.label}  [${s.tenant ? `${s.tenant} ` : ''}${s.brand}/${s.theme}]${s.images.composite ? `  ${s.images.composite}` : ''}`);
  print(`manifest: ${r.manifestPath}`);
  if (r.commentPath) print(`comment:  ${r.commentPath}`);
  return 0;
}

const day = (iso: string) => iso.slice(0, 10);

async function historyCmd(a: Args, root: string): Promise<number> {
  const ctx = await BridgeContext.create({ root });
  const token = a._[1];
  const limit = Number(flag(a, 'limit') ?? 20);
  if (token) {
    const r = await hist.getTokenHistory(ctx, { path: token, limit });
    if (has(a, 'json')) return print(JSON.stringify(r, null, 2)), 0;
    if (!r.total) return print(`No recorded change of ${r.path} in ${r.source}.`), 0;
    print(`${r.path}: ${r.total} change(s)  (${r.source})\n`);
    for (const c of r.changes) {
      const vals = c.kind === 'changed' ? `${c.beforeCss ?? ''} -> ${c.afterCss ?? ''}` : c.kind === 'added' ? `added ${c.afterCss ?? ''}` : c.kind === 'removed' ? `removed (was ${c.beforeCss ?? ''})` : `renamed from ${c.from}`;
      print(`  ${day(c.date)}  ${(c.pr ? `#${c.pr}` : c.entry).padEnd(8)} ${c.mode.padEnd(11)} ${vals}`);
      print(`              ${c.title} (${c.author})${c.version ? `  [${c.version}]` : ''}`);
    }
    return 0;
  }
  const tier = flag(a, 'tier');
  const r = await hist.getHistory(ctx, { limit, ...(flag(a, 'author') ? { author: flag(a, 'author')! } : {}), ...(tier ? { tier: Number(tier) as 1 | 2 | 3 } : {}), ...(flag(a, 'version') ? { version: flag(a, 'version')! } : {}), ...(has(a, 'breaking') ? { breaking: true } : {}) });
  if (has(a, 'json')) return print(JSON.stringify(r, null, 2)), 0;
  print(`${r.source}${r.currentVersion ? `, package version ${r.currentVersion}` : ''}`);
  if (!r.total) return print(r.note ?? 'No token change matches.'), 0;
  for (const v of r.versions) print(`  ${v.version.padEnd(11)} ${day(v.date)}  ${v.entries} change(s), ${v.tokenChanges} token edit(s)${v.breaking ? ', breaking' : ''}`);
  print('');
  for (const e of r.entries) {
    const n = e.counts;
    const counts = [n.changed && `${n.changed} changed`, n.added && `${n.added} added`, n.removed && `${n.removed} removed`, n.renamed && `${n.renamed} renamed`].filter(Boolean).join(', ');
    print(`  ${day(e.date)}  ${e.id.padEnd(9)} T${e.tier} ${e.bump.padEnd(5)}${e.breaking ? ' !' : '  '} ${e.title}`);
    print(`              ${e.author}, ${counts}${e.bulk ? ' (bulk import)' : ''}${e.version ? `  [${e.version}]` : ''}`);
  }
  if (r.truncated) print(`\n${r.truncated}`);
  return 0;
}

async function revertCmd(a: Args, root: string): Promise<number> {
  const target = a._[1];
  if (!target) throw new UsageError('bridge revert <pr|commit|id> [--dry-run]   (ids from `bridge history`)');
  const ctx = await BridgeContext.create({ root });
  const resolutions = Object.fromEntries((a.flags['use-before'] ?? []).map((k) => [k, 'use-before' as const]));
  const r = (await hist.proposeRevert(ctx, { target, resolutions, restoreConflicts: has(a, 'restore-conflicts'), dryRun: has(a, 'dry-run') })) as Record<string, any>;
  if (has(a, 'json')) {
    print(JSON.stringify(r, null, 2));
    return r.status === 'blocked' ? 1 : 0;
  }
  print(`status: ${r.status}${r.why ? ` (${r.why})` : ''}`);
  if (r.reverts) print(`reverts: ${r.reverts.pr ? `#${r.reverts.pr} ` : ''}${r.reverts.title} (${day(r.reverts.date)}, ${r.reverts.author})`);
  if (r.tier) print(`tier ${r.tier}, ${r.bump}`);
  for (const e of r.edits ?? []) print(`  edit      ${e}`);
  for (const c of r.conflicts ?? []) {
    print(`  conflict  ${c.path} (${c.file}): ${c.message}`);
    if (c.later.length) print(`            changed later in ${c.later.join('; ')}`);
    print(`            ${c.resolution === 'use-before' ? 'restoring the old value' : `kept as it is. To restore it: --use-before ${c.key}`}`);
  }
  for (const s of r.skipped ?? []) print(`  skipped   ${s}`);
  if (r.contrast?.moved) print(`contrast: ${r.contrast.moved} pair(s) move, ${r.contrast.newFailures.length} new failure(s)`);
  if (r.branch) print(`branch: ${r.branch}`);
  if (r.next) print(String(r.next));
  if (r.status === 'dry-run') print(`\n${r.prBody}`);
  return r.status === 'blocked' ? 1 : 0;
}

class UsageError extends Error {}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const a = parse(argv);
  const cmd = a._[0];
  const root = resolve(flag(a, 'root') ?? process.cwd());
  if (!cmd || has(a, 'help') || cmd === 'help') {
    print(HELP);
    return cmd ? 0 : 2;
  }
  if (cmd === '--version' || cmd === 'version') return print(VERSION), 0;
  switch (cmd) {
    case 'init':
      await init(a, root);
      return 0;
    case 'check':
      return check(a, root);
    case 'tokens':
      await tokens(a, root);
      return 0;
    case 'diff':
      return diff(a, root);
    case 'propose':
      return propose(a, root);
    case 'impact':
      return impact(a, root);
    case 'history':
      return historyCmd(a, root);
    case 'revert':
      return revertCmd(a, root);
    case 'mcp':
      await serveStdio(optionsFromArgv(argv.slice(1)));
      return -1;
    default:
      throw new UsageError(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

main().then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (e: Error) => {
    process.stderr.write(`bridge: ${e.message}\n`);
    process.exitCode = 2;
  },
);
