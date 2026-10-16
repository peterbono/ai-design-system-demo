#!/usr/bin/env node
// bridge: CLI for the Bridge design-system-as-code tools. Small on purpose: Node built-ins + @bridge/mcp.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { auditMarkdown, type AuditReport } from '@bridge/core/audit';
import { findDesignSystemRoot, fixCss, loadDesignSystem, originRepo, runAudit } from '@bridge/core/node';
import { fileURLToPath } from 'node:url';
import { BridgeContext, CONFIG_FILE, core, detectConfig, GitRefSource, LocalSource, ops, optionsFromArgv, serveStdio, toConfigJson, VERSION, type BridgeConfig } from '@bridge/mcp';

const HELP = `bridge ${VERSION}: design system as code, for you and your Claude

Usage:
  bridge init [--force]               write bridge.config.json (detected) and .mcp.json for Claude Code
  bridge check [--json] [--strict]    validate tokens + contrast gate. Exit 0 ok, 1 failures, 2 setup error
  bridge tokens <query> [--json]      search tokens by name, description or value
  bridge diff <base> [--json|--md]    designer-readable token diff: working tree vs <base> (git ref)
  bridge propose --title "..." --set path=value [--set ...] [--file f | --mode theme=dark]
                 [--edits edits.json] [--summary "..."] [--dry-run]
                                      validate + contrast + new local bridge/* branch (never pushes)
  bridge audit <path> [--json [out.json]] [--md [out.md]] [--fail-under 80] [--baseline prev.json]
               [--label "..."] [--ds dir] [--no-regress]
                                      design system adoption in a product folder: token and component
                                      adoption, hardcoded values with the closest token, top files.
                                      Exit 0 ok, 1 under --fail-under or regressed, 2 setup error
  bridge audit <path> --fix [--write] safe autofix: CSS values equal to a token become var(--token).
                                      Dry run unless --write
  bridge mcp [--root dir | --repo owner/name]   start the MCP server on stdio

Options:
  --root <dir>   repo root (default: current directory)
  --ds <dir>     audit: design system repo with bridge.config.json (default: --root, or the nearest one above)
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
      const next = argv[i + 1];
      // --json and --md print to stdout, or write a file when followed by one (bridge audit).
      const fileArg = (k === 'json' && /\.json$/i.test(next ?? '')) || (k === 'md' && /\.(md|markdown)$/i.test(next ?? ''));
      const takesValue = inline === undefined && next !== undefined && !next.startsWith('--') && (fileArg || !['force', 'json', 'md', 'strict', 'dry-run', 'help', 'fix', 'write', 'no-regress'].includes(k));
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

async function audit(a: Args, root: string): Promise<number> {
  const target = a._[1];
  if (!target) throw new UsageError('bridge audit <path>   (a product folder or file that uses the design system)');
  if (!existsSync(target)) throw new UsageError(`No such file or folder: ${target}`);
  const dsRoot = flag(a, 'ds') ? resolve(flag(a, 'ds')!) : existsSync(join(root, CONFIG_FILE)) ? root : findDesignSystemRoot(root);
  if (!dsRoot) throw new UsageError(`No ${CONFIG_FILE} found: run bridge audit from the design system repo or pass --ds <dir>.`);
  const ds = loadDesignSystem(dsRoot);
  if (has(a, 'fix')) {
    const write = has(a, 'write');
    const changes = fixCss(target, ds.index, write);
    const n = changes.reduce((acc, c) => acc + c.edits.length, 0);
    for (const c of changes) for (const e of c.edits) print(`${c.file}:${e.line}:${e.column}  ${e.from} -> ${e.to}`);
    print(n ? `${write ? 'Replaced' : 'Would replace'} ${n} value(s) in ${changes.length} file(s) with exact token matches.${write ? '' : ' Run again with --write to apply.'}` : 'Nothing to fix: no CSS value equals a token exactly.');
    return 0;
  }
  const baselinePath = flag(a, 'baseline');
  let baseline: AuditReport | undefined;
  if (baselinePath) {
    if (!existsSync(baselinePath)) throw new UsageError(`Baseline not found: ${baselinePath}`);
    baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as AuditReport;
  }
  const label = flag(a, 'label');
  const report = runAudit(target, { ds: dsRoot, version: VERSION, ...(label ? { label } : {}), ...(baseline ? { baseline } : {}) });
  const md = auditMarkdown(report);
  const jsonOut = flag(a, 'json');
  const mdOut = flag(a, 'md');
  if (jsonOut && jsonOut !== 'true') await writeFile(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  if (mdOut && mdOut !== 'true') await writeFile(mdOut, `${md}\n`);
  if (jsonOut === 'true') print(JSON.stringify(report, null, 2));
  else if (mdOut === 'true') print(md);
  else {
    const m = report.metrics;
    print(`bridge audit ${report.target.path}: ${report.target.files} files`);
    print(`  token adoption      ${m.tokenAdoption ?? 'n/a'}${m.tokenAdoption === null ? '' : '%'}  (${m.tokenUsages} token refs, ${m.hardcoded} hardcoded, ${m.themeRefs} other theme refs)`);
    print(`  component adoption  ${m.componentAdoption ?? 'n/a'}${m.componentAdoption === null ? '' : '%'}  (${m.dsComponentInstances} of ${m.uiComponentInstances} UI component instances)`);
    if (report.baseline) {
      const b = report.baseline;
      const d = (x: number | null) => (x === null ? 'n/a' : `${x > 0 ? '+' : ''}${x} pts`);
      print(`  since baseline      tokens ${d(b.tokenAdoption.delta)}, components ${d(b.componentAdoption.delta)}, hardcoded ${b.hardcoded.delta > 0 ? '+' : ''}${b.hardcoded.delta}; ${b.improved.length} files improved, ${b.regressed.length} regressed`);
    }
    const cats = Object.entries(report.byCategory).map(([k, v]) => `${k} ${v.hardcoded}`).join(', ');
    if (cats) print(`  hardcoded by category: ${cats}`);
    if (report.topFiles.length) {
      print('  top files:');
      for (const f of report.topFiles.slice(0, 5)) print(`    ${f.path}  ${f.hardcoded} hardcoded, ${f.otherComponents} non-DS components`);
    }
    const fixes = report.topFixes.filter((f) => f.suggestion).slice(0, 5);
    if (fixes.length) {
      print('  top fixes:');
      for (const f of fixes) print(`    ${f.value} -> var(${f.suggestion!.cssVar})  ${f.suggestion!.level}, ${f.count}x`);
    }
    if (jsonOut) print(`Wrote ${jsonOut}`);
    if (mdOut) print(`Wrote ${mdOut}`);
  }
  let code = 0;
  const failUnder = flag(a, 'fail-under');
  if (failUnder !== undefined) {
    const min = Number(failUnder);
    if (!Number.isFinite(min)) throw new UsageError('--fail-under needs a number, e.g. --fail-under 80');
    const low = (['tokenAdoption', 'componentAdoption'] as const).filter((k) => report.metrics[k] !== null && report.metrics[k]! < min);
    if (low.length) {
      process.stderr.write(`bridge audit: ${low.map((k) => `${k === 'tokenAdoption' ? 'token' : 'component'} adoption ${report.metrics[k]}%`).join(' and ')} under ${min}%\n`);
      code = 1;
    }
  }
  if (has(a, 'no-regress') && report.baseline) {
    const b = report.baseline;
    if ((b.tokenAdoption.delta ?? 0) < 0 || (b.componentAdoption.delta ?? 0) < 0 || b.hardcoded.delta > 0) {
      process.stderr.write('bridge audit: adoption regressed since the baseline\n');
      code = 1;
    }
  }
  return code;
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
    case 'audit':
      return audit(a, root);
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
