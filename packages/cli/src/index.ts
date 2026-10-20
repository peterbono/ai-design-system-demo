#!/usr/bin/env node
// bridge: CLI for the Bridge design-system-as-code tools. Small on purpose: Node built-ins + @bridge-ds/mcp.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { auditMarkdown, type AuditReport } from '@bridge-ds/core/audit';
import { findDesignSystemRoot, fixCss, loadAllowlist, loadDesignSystem, originRepo, runAudit } from '@bridge-ds/core/node';
import { fileURLToPath } from 'node:url';
import { captureFigmaReferences, runImpact, type Only } from '@bridge-ds/visual';
import { execFileSync } from 'node:child_process';
import { runRequest } from './request.js';
import { runExplore } from './explore.js';
import { runBranch, runDocsSave, runStudioRead } from './branch.js';
import { defaultIO } from './request.js';
import { protectionReport, type ProtectionReport } from './protection.js';
import { rolesReport, type RolesReport } from './roles.js';
import { brand, BridgeContext, CONFIG_FILE, core, detectConfig, GitRefSource, history as hist, LocalSource, ops, optionsFromArgv, serveStdio, toConfigJson, VERSION, type BridgeConfig } from '@bridge-ds/mcp';

/** The MCP server on npm, written into .mcp.json by `bridge init`. */
const MCP_PACKAGE = '@bridge-ds/mcp';

const HELP = `bridge ${VERSION}: design system as code, for you and your Claude

Usage:
  bridge init [--force]               write bridge.config.json (detected) and .mcp.json for Claude Code
  bridge check [--json] [--strict] [--offline]
                                      validate tokens + contrast gate, and say whether the library is
                                      protected (reviewed pull requests only) and who is in the GitHub
                                      teams named as owners, reporting teams it cannot read (neither
                                      changes the exit code; --offline skips both). Exit 0 ok, 1 failures,
                                      2 setup error
  bridge tokens <query> [--json]      search tokens by name, description or value
  bridge diff <base> [--json|--md]    designer-readable token diff: working tree vs <base> (git ref)
  bridge propose --title "..." --set path=value [--set ...] [--file f | --mode theme=dark]
                 [--edits edits.json] [--summary "..."] [--branch explore/<name>] [--pr <n>]
                 [--product <key>] [--jira DS-42] [--dry-run]
                                      validate + contrast + new local bridge/* branch (never pushes).
                                      --branch: write the edits to the checked-out exploration instead.
                                      --pr: add them to that branch in review (GitHub token).
                                      --product: the product it is for (bridge products); --jira: the
                                      ticket key, first in the branch name and title
  bridge brand list [--json]          brands: slug, name, default, primary action color, theme overrides
  bridge brand create <slug> --from bridge --primary <hex|hue> --neutral <hex|hue>
                 [--name "Acme"] [--accent x] [--link x] [--radius soft|balanced|crisp|i,c,co,o]
                 [--heading font] [--text font] [--notes "..."] [--dry-run] [--json]
                                      new brand: generated ramps, contrast gate for every theme,
                                      new local bridge/brand-<slug> branch (never pushes, never main).
                                      Exit 1 when blocked
  bridge impact [--base main] [--head HEAD] [--out dir] [--only stories|app] [--threshold 0.03]
                 [--plan] [--json] [--image-base url] [--artifact-url url] [--keep-unchanged]
                                      visual impact: build Storybook and the app at both refs, screenshot
                                      what the change touches, pixel-diff, write manifest.json + images.
                                      Exit 0 even with diffs (2 on setup errors). Needs Chrome installed.
  bridge figma-references [--storybook storybook-static] [--specs packages/react/component-specs.json]
                 [--out figma-references] [--sha <sha>] [--only Button,Card] [--json]
                                      code images for the Figma fidelity check: one PNG per generated
                                      Figma variant from a built Storybook, plus manifest.json.
                                      Needs Chrome installed
  bridge history [token] [--json] [--limit n] [--author a] [--tier n] [--version v]
                                      token history: versions, merged changes, who, when, why
  bridge revert <pr|commit|id> [--dry-run] [--restore-conflicts] [--use-before path@file] [--json]
                                      undo a merged token change against HEAD: conflicts shown,
                                      new local bridge/* branch (never pushes, never main)
  bridge audit <path> [--json [out.json]] [--md [out.md]] [--fail-under 80] [--baseline prev.json]
               [--label "..."] [--ds dir] [--no-regress] [--allowlist known.json]
                                      design system adoption in a product folder: token and component
                                      adoption, hardcoded values with the closest token, top files.
                                      Reads CSS, SCSS, Less, TS/JS, TSX/JSX, and Astro, Vue and Svelte
                                      (template markup, frontmatter and <script>, <style> blocks).
                                      Leave one exception out with a comment on the line above:
                                      <!-- bridge-audit-ignore-next-line: reason --> (or // or /* */);
                                      --allowlist lists known file:line exceptions, each with a reason.
                                      Ignored items stay listed in the report.
                                      Exit 0 ok, 1 under --fail-under or regressed, 2 setup error
  bridge audit <path> --fix [--write] safe autofix: CSS values equal to a token become var(--token).
                                      Dry run unless --write
  bridge docs draft <Component> [--json]
                                      docs.json pre-fill from the code (props, tokens, anatomy, contrast,
                                      changelog line, missing keys) and a prompt for Claude to write the
                                      prose. --json prints { path, prefill, prompt }. Writes nothing
  bridge request list [--status requested|in-progress|done|declined|all] [--component Button] [--json]
  bridge request show <number> [--json]
  bridge request implement <number> [--claude]
                                      component change requests (GitHub issues labeled component-change):
                                      list them, read one, print the brief to implement it (--claude starts
                                      Claude Code with it). \`bridge request help\` for create and jira-sync
  bridge request create --component Button --kind new-variant --title "..." --summary "..."
                 [--change field=before:after] [--figma url] [--exploration explore/<name>] [--dry-run]
                                      file a request as a GitHub issue (needs a GitHub token)
  bridge explore start <name> --purpose "..." [--use-case user-test|stakeholder-demo|ab-idea|terminal]
  bridge explore list [--all] [--json]
  bridge explore promote <name|#pr> [--dry-run]
  bridge explore close <name|#pr>
                                      explorations: an explore/<name> branch with a draft pull request
                                      labeled exploration, previews and a snapshot package for a product
                                      staging branch. Never merged as is: promote it to review or close it
  bridge branch list|status|comments|ready|draft|review|ask|comment|merge|close|reopen|update|try|combine
                                      branches in review, the same actions as Bridge Studio
                                      (\`bridge branch help\`): what needs me, send for review, review,
                                      merge through the same gate (owner override with a reason), update
                                      from main with token conflicts, try it in a product, try together
  bridge products | bridge settings | bridge coverage [Component]
                                      products (and this folder's), Studio settings safe to read, which
                                      components are in Figma
  bridge docs save <Component> --file docs.json [--pr n] [--jira DS-42] [--product key] [--dry-run]
                                      save usage guidance as in the Library edit mode (GitHub token)
  bridge mcp [--root dir | --repo owner/name]   start the MCP server on stdio

Options:
  --root <dir>   repo root (default: current directory)
  --ds <dir>     audit: design system repo with bridge.config.json (default: --root, or the nearest one above)
  GITHUB_TOKEN   env, optional: lets the MCP server open PRs on a remote repo, and bridge request create
                 file issues (else \`gh auth token\`). Never needed for local token work.
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
      const takesValue = inline === undefined && next !== undefined && !next.startsWith('--') && (fileArg || !['force', 'json', 'md', 'strict', 'dry-run', 'help', 'fix', 'write', 'no-regress', 'plan', 'keep-unchanged', 'restore-conflicts', 'breaking', 'claude', 'all', 'offline', 'approve'].includes(k));
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
  // Server command: npx @bridge-ds/mcp from npm. Inside the Bridge repo itself, the local build (works offline,
  // and runs the code you are changing).
  const serverJs = fileURLToPath(new URL('./index.js', import.meta.resolve('@bridge-ds/mcp')));
  const relServer = relative(root, serverJs);
  const inRepo = !relServer.startsWith('..') && !isAbsolute(relServer);
  const server = (dir: string) => (inRepo ? { command: 'node', args: [relServer, '--root', dir] } : { command: 'npx', args: ['-y', MCP_PACKAGE, '--root', dir] });
  const mcpPath = join(root, '.mcp.json');
  const existing = existsSync(mcpPath) ? (JSON.parse(await readFile(mcpPath, 'utf8')) as { mcpServers?: Record<string, unknown> }) : {};
  existing.mcpServers = { ...(existing.mcpServers ?? {}), bridge: server('.') };
  await writeFile(mcpPath, `${JSON.stringify(existing, null, 2)}\n`);
  print(`Wrote .mcp.json: Claude Code picks up the "bridge" server next time it starts in ${root}.`);
  const desktop = inRepo ? { command: 'node', args: [serverJs, '--root', root] } : server(root);
  print('\nClaude Desktop: add this to claude_desktop_config.json (Settings > Developer > Edit config):');
  print(JSON.stringify({ mcpServers: { bridge: desktop } }, null, 2));
  print('\nOr with the Claude Code CLI:');
  print(`  claude mcp add bridge -- ${desktop.command} ${desktop.args.join(' ')}`);
}

async function check(a: Args, root: string): Promise<number> {
  const ctx = await BridgeContext.create({ root });
  const v = await ops.validateTokens(ctx, { includeWarnings: true });
  const c = await ops.checkContrast(ctx, {});
  const warnings = 'warnings' in v ? (v.warnings ?? []) : [];
  const failed = !v.valid || ('failing' in c && (c.failing ?? 0) > 0) || (has(a, 'strict') && warnings.length > 0);
  const protection = await protectionOf(a, root, ctx);
  const roles = await rolesOf(a, root, ctx);
  if (has(a, 'json')) {
    print(JSON.stringify({ ok: !failed, validation: v, contrast: c, ...(protection ? { protection: protection.state } : {}), ...(roles?.teams.length ? { teams: roles.teams } : {}) }, null, 2));
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
  for (const line of protection?.lines ?? []) print(line);
  for (const line of roles?.lines ?? []) print(line);
  print(failed ? 'FAIL' : 'OK');
  return failed ? 1 : 0;
}

/**
 * Whether the default branch only takes reviewed pull requests. Skipped with --offline or BRIDGE_OFFLINE=1, and
 * when the repo is unknown (no "repo" in bridge.config.json, no GitHub origin). Token: BRIDGE_GITHUB_TOKEN or
 * GITHUB_TOKEN, optional (a public repo reads without one).
 */
async function protectionOf(a: Args, root: string, ctx: BridgeContext): Promise<ProtectionReport | undefined> {
  if (has(a, 'offline') || process.env.BRIDGE_OFFLINE === '1') return undefined;
  const { config } = await ctx.config();
  const repo = config.repo ? `${config.repo.owner}/${config.repo.name}` : await originRepo(root);
  if (!repo) return undefined;
  const token = process.env.BRIDGE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || undefined;
  return protectionReport({ repo, defaultBranch: config.repo?.defaultBranch ?? 'main', token });
}

/**
 * Who the GitHub teams in governance.owners are, and which cannot be read (and why). Skipped like the protection
 * line, and when no team is named. Token: BRIDGE_GITHUB_TOKEN or GITHUB_TOKEN; reading teams needs read:org.
 */
async function rolesOf(a: Args, root: string, ctx: BridgeContext): Promise<RolesReport | undefined> {
  if (has(a, 'offline') || process.env.BRIDGE_OFFLINE === '1') return undefined;
  const { config } = await ctx.config();
  const repo = config.repo ? `${config.repo.owner}/${config.repo.name}` : await originRepo(root);
  if (!repo) return undefined;
  const token = process.env.BRIDGE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || undefined;
  return rolesReport({ repo, owners: config.governance.owners, token });
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
  const pr = flag(a, 'pr');
  // Adding to a branch in review writes on GitHub: the token the other GitHub commands use.
  const token = pr ? process.env.BRIDGE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || defaultIO().ghToken() : undefined;
  const ctx = await BridgeContext.create({ root, ...(token ? { token } : {}) });
  const summary = flag(a, 'summary');
  const branch = flag(a, 'branch');
  const jira = flag(a, 'jira');
  const product = flag(a, 'product');
  const r = (await ops.proposeTokenChange(ctx, {
    title,
    edits: edits as never,
    ...(summary ? { summary } : {}),
    ...(branch ? { branch } : {}),
    ...(pr ? { pr } : {}),
    ...(jira ? { jira } : {}),
    ...(product ? { product } : {}),
    dryRun: has(a, 'dry-run'),
  })) as Record<string, unknown>;
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

async function brandCmd(a: Args, root: string): Promise<number> {
  const sub = a._[1];
  const ctx = await BridgeContext.create({ root });
  if (sub === 'list') {
    const r = await brand.listBrands(ctx);
    if (has(a, 'json')) print(JSON.stringify(r.brands, null, 2));
    else for (const b of r.brands) print(`${b.default ? '*' : ' '} ${b.slug.padEnd(14)} ${b.name.padEnd(18)} ${b.primary ?? ''}${b.overrides.length ? `  overrides: ${b.overrides.join(', ')}` : ''}`);
    return 0;
  }
  if (sub !== 'create') throw new UsageError('bridge brand list | bridge brand create <slug> --from bridge --primary "#1F5F3A" --neutral "#2A2F2C"');
  const slug = a._[2];
  if (!slug) throw new UsageError('bridge brand create <slug> --from bridge --primary "#1F5F3A" --neutral "#2A2F2C"');
  const opt = (k: string) => flag(a, k);
  const fonts = { ...(opt('heading') ? { heading: opt('heading')! } : {}), ...(opt('text') ? { text: opt('text')! } : {}) };
  const r = (await brand.proposeBrand(ctx, {
    slug,
    ...(opt('name') ? { name: opt('name')! } : {}),
    ...(opt('from') ? { from: opt('from')! } : {}),
    ...(opt('primary') ? { primary: opt('primary')! } : {}),
    ...(opt('neutral') ? { neutral: opt('neutral')! } : {}),
    ...(opt('accent') ? { accent: opt('accent')! } : {}),
    ...(opt('link') ? { link: opt('link')! } : {}),
    ...(opt('radius') ? { radius: opt('radius')! } : {}),
    ...(Object.keys(fonts).length ? { fonts } : {}),
    ...(opt('notes') ? { notes: opt('notes')! } : {}),
    dryRun: has(a, 'dry-run'),
  })) as Record<string, any>;
  if (has(a, 'json')) {
    const { fileContents: _f, ...rest } = r;
    print(JSON.stringify(rest, null, 2));
    return r.status === 'blocked' ? 1 : 0;
  }
  print(`status: ${r.status}${r.why ? ` (${r.why})` : ''}`);
  print(`${r.name} (${r.slug}), from ${r.from}. Tier ${r.tier}, ${r.bump}.`);
  for (const [role, ramp] of Object.entries(r.ramps as Record<string, Record<string, string>>)) {
    print(`  ${role.padEnd(8)} ${Object.entries(ramp).map(([s, h]) => `${s} ${h}`).join('  ')}`);
  }
  print(`contrast: ${r.contrast.line}${r.contrast.themes.length ? ` (${r.contrast.themes.join(', ')})` : ''}`);
  for (const f of r.contrast.failing) print(`    FAIL ${f.pair} [${f.modes}] ${f.ratio ?? 'n/a'} (min ${f.min})`);
  for (const i of r.issues as { level: string; message: string }[]) print(`  ${i.level}: ${i.message}`);
  print('files:');
  for (const f of r.files as { path: string; action: string }[]) print(`  ${f.action} ${f.path}`);
  if (r.branch) print(`branch: ${r.branch}`);
  if (r.next) print(String(r.next));
  if (r.hint) print(String(r.hint));
  return r.status === 'blocked' ? 1 : 0;
}

async function figmaReferences(a: Args, root: string): Promise<number> {
  let sha = flag(a, 'sha');
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    } catch {
      sha = 'unknown';
    }
  }
  const only = (flag(a, 'only') ?? '').split(',').filter(Boolean);
  const r = await captureFigmaReferences({
    storybook: resolve(root, flag(a, 'storybook') ?? 'storybook-static'),
    specs: resolve(root, flag(a, 'specs') ?? 'packages/react/component-specs.json'),
    out: resolve(root, flag(a, 'out') ?? 'figma-references'),
    sha,
    ...(only.length ? { only } : {}),
    log: has(a, 'json') ? undefined : (line) => print(line),
  });
  if (has(a, 'json')) print(JSON.stringify({ manifest: r.manifestPath, captured: r.captured, skipped: r.skipped }, null, 2));
  return 0;
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
  const allowlistPath = flag(a, 'allowlist');
  if (allowlistPath && !existsSync(allowlistPath)) throw new UsageError(`Allowlist not found: ${allowlistPath}`);
  let allowlist;
  try {
    allowlist = allowlistPath ? loadAllowlist(allowlistPath) : undefined;
  } catch (e) {
    throw new UsageError(`${allowlistPath}: ${(e as Error).message}`);
  }
  const report = runAudit(target, { ds: dsRoot, version: VERSION, ...(label ? { label } : {}), ...(baseline ? { baseline } : {}), ...(allowlist ? { allowlist } : {}) });
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
    const ig = report.ignored;
    if (ig?.total) print(`  ignored on purpose  ${ig.total} (${ig.comment} by comment, ${ig.allowlist} by the allowlist); listed in --json and --md`);
    if (ig?.staleAllowlist.length) {
      print(`  allowlist entries that match nothing any more (remove them):`);
      for (const e of ig.staleAllowlist) print(`    ${e.file}:${e.line}${e.what ? ` ${e.what}` : ''}`);
    }
    if (jsonOut) print(`Wrote ${jsonOut}`);
    if (mdOut) print(`Wrote ${mdOut}`);
  }
  for (const f of report.files) for (const e of f.ignoreErrors ?? []) process.stderr.write(`${report.target.path}/${f.path}:${e.line}: ${e.message}\n`);
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

async function docsCmd(a: Args, root: string): Promise<number> {
  const [, sub, name] = a._;
  if (sub !== 'draft' || !name) throw new UsageError('Usage: bridge docs draft <Component> [--json]');
  const ctx = await BridgeContext.create({ root });
  const d = await ops.draftDocsOp(ctx, { name });
  if (has(a, 'json')) {
    print(JSON.stringify({ component: d.component, path: d.path, exists: d.exists, prefill: d.prefill, prompt: d.prompt }, null, 2));
    return 0;
  }
  const p = d.prefill;
  print(`${d.component}: ${d.path}${d.exists ? '' : ' (not written yet)'}`);
  print(`\nProps\n${p.propsTable || '  none of its own'}`);
  print(`\nTokens (${p.tokens.length}): ${p.tokens.join(', ') || 'none'}`);
  for (const [from, list] of Object.entries(p.inheritedTokens)) print(`  plus ${list.length} through ${from}'s stylesheet`);
  print('\nAnatomy');
  for (const [k, v] of Object.entries(p.anatomy)) print(`  .${k}  ${v}`);
  if (p.contrastNotes.length) {
    print('\nContrast');
    for (const n of p.contrastNotes) print(`  ${n}`);
  }
  print(`\nChangelog line: ${p.changelogLine}`);
  print(`Missing prose: ${p.missing.join(', ') || 'none'}`);
  print('\nPrompt for Claude (write the prose, set "draftedBy": "claude" and "needsReview": true):\n');
  print(d.prompt);
  return 0;
}

class UsageError extends Error {}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const a = parse(argv);
  const cmd = a._[0];
  const root = resolve(flag(a, 'root') ?? process.cwd());
  if (cmd === 'request') return runRequest(a, root);
  if (cmd === 'explore') return runExplore(a, root);
  if (cmd === 'branch') return runBranch(a, root);
  if (cmd === 'products' || cmd === 'settings' || cmd === 'coverage') return runStudioRead(cmd, a, root);
  if (cmd === 'docs' && a._[1] === 'save') return runDocsSave(a, root);
  if (!cmd || has(a, 'help') || cmd === 'help') {
    print(HELP);
    // Asked for (`help`, `--help`): exit 0. No command at all is a usage error: exit 2.
    return cmd || has(a, 'help') ? 0 : 2;
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
    case 'brand':
      return brandCmd(a, root);
    case 'impact':
      return impact(a, root);
    case 'figma-references':
      return figmaReferences(a, root);
    case 'history':
      return historyCmd(a, root);
    case 'revert':
      return revertCmd(a, root);
    case 'audit':
      return audit(a, root);
    case 'docs':
      return docsCmd(a, root);
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
