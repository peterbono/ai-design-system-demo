#!/usr/bin/env node
// bridge: CLI for the Bridge design-system-as-code tools. Small on purpose: Node built-ins + @bridge-ds/mcp.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { MEASURE_WORKFLOW_FILE } from '@bridge-ds/core';
import { auditMarkdown, type AuditReport } from '@bridge-ds/core/audit';
import { findDesignSystemRoot, fixCss, loadAllowlist, loadDesignSystem, originRepo, runAudit } from '@bridge-ds/core/node';
import { fileURLToPath } from 'node:url';
import { captureFigmaReferences, runImpact, type Only } from '@bridge-ds/visual';
import { execFileSync } from 'node:child_process';
import { runRequest } from './request.js';
import { runBuild } from './build-requests.js';
import { runExplore } from './explore.js';
import { runBranch, runDocsSave, runStudioRead } from './branch.js';
import { runPieces } from './pieces.js';
import { runFigma } from './figma.js';
import { runSpecs } from './specs.js';
import { runFixes, runGap } from './fixes.js';
import { runFix, runGaps } from './fix.js';
import { runMeasure } from './measure.js';
import { snapshotLines, writeSnapshot } from './snapshot.js';
import { changesFlag, runApply, runReview, runSuggestions } from './suggest.js';
import { defaultIO } from './request.js';
import { chooseToken, cliContext, needsWriteToken, WRITE_TOKEN_HOW, type Access } from './auth.js';
import { protectionReport, type ProtectionReport } from './protection.js';
import { rolesReport, type RolesReport } from './roles.js';
import { brand, BridgeContext, CONFIG_FILE, core, detectConfig, GitRefSource, history as hist, LocalSource, ops, optionsFromArgv, serveStdio, toConfigJson, type BridgeConfig } from '@bridge-ds/mcp';

declare const __BRIDGE_CLI_VERSION__: string | undefined;
/** This package's version, set at build time (build.mjs). Audit reports and snapshots record it: the CLI produces them. */
const VERSION = typeof __BRIDGE_CLI_VERSION__ === 'string' ? __BRIDGE_CLI_VERSION__ : 'dev';

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
  bridge tokens <query> [--limit 20] [--json]
                                      search tokens by name, description or value (the best 20 first,
                                      and how many more match)
  bridge diff <base> [--json|--md]    designer-readable token diff: working tree vs <base> (git ref)
  bridge propose --title "..." --set path=value [--set ...] [--file f | --mode theme=dark]
                 [--edits edits.json] [--summary "..."] [--branch explore/<name>] [--pr <n>]
                 [--product <key>] [--jira DS-42] [--suggest | --direct] [--dry-run]
                                      validate + contrast, then a suggestion (a GitHub issue a developer
                                      applies with bridge apply) or, with "changes": "direct" in
                                      bridge.config.json or --direct, a new local bridge/* branch (never pushes).
                                      --branch: write the edits to the checked-out exploration instead.
                                      --pr: add them to that branch in review (GitHub token).
                                      --product: the product it is for (bridge products); --jira: the
                                      ticket key, first in the branch name and title
  bridge brand list [--json]          brands: slug, name, default, primary action color, theme overrides
  bridge brand create <slug> --from bridge --primary <hex|hue> --neutral <hex|hue>
                 [--name "Acme"] [--accent x] [--link x] [--radius soft|balanced|crisp|i,c,co,o]
                 [--heading font] [--text font] [--notes "..."] [--suggest | --direct] [--dry-run] [--json]
                                      new brand: generated ramps, contrast gate for every theme, then a
                                      suggestion, or in direct mode a new local bridge/brand-<slug> branch
                                      (never pushes, never main).
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
  bridge specs --measure --storybook <url> [--only Button,Card] [--stories id,id] [--per 3]
               [--open] [--within <selector>] [--variants] [--states rest,hover,disabled]
               [--check] [--specs component-specs.json] [--tokens] [--shots] [--resume] [--out measured-specs.json] [--json]
                                      measure what each story really draws in Chrome: layers, boxes, auto
                                      layout, fills, borders, radii, text styles, and the token behind each
                                      value, in the component specs shape, with the props it rendered with.
                                      --variants measures every variant, --check gives each component a
                                      status. Any React Storybook, any styling. Needs Chrome installed
  bridge fixes check [--fixes figma-fixes.json] [--in measured-specs.json] [--json]
  bridge fixes apply --in measured-specs.json --out <file> [--fixes figma-fixes.json] [--json]
                                      the team's corrections for the Figma pull (part patches, axis
                                      mapping, story pointers, honest statuses): validate them, or write
                                      the measure with them laid on, one line per fix. Exit 1 when invalid
  bridge gap <component> [--in measured-specs.json] [--fidelity report.json] [--specs specs.json]
             [--built built.json] [--shots manifest.json] [--no-fixes] [--json]
                                      what differs between Figma and the code for one component, per
                                      variant: story, args, state, shot and each difference in words
  bridge measure setup [--storybook <url> | --build] [--force] [--print]
                                      the automatic measure: writes .github/workflows/bridge-measure.yml,
                                      which measures your Storybook each time it changes and publishes the
                                      measure to the bridge-requests branch, where Claude reads it to fix
                                      what differs in Figma (\`bridge measure help\`)
  bridge gaps [--json]                Fix with Claude: the components whose Figma build differs from their
                                      story (or can't be checked), from the plugin's Check fidelity run
  bridge fix <component> [--case | --try fixes.json | --propose fixes.json --summary "..." | --with-claude]
                                      its gap case and the fix schema; the values referee on fixes (closer,
                                      same or worse, offline); figma-fixes.json on a branch for review;
                                      or the loop with your own ANTHROPIC_API_KEY (\`bridge fix help\`)
  bridge history [token] [--json] [--limit n] [--author a] [--tier n] [--version v]
                                      token history: versions, merged changes, who, when, why
  bridge revert <pr|commit|id> [--dry-run] [--restore-conflicts] [--use-before path@file] [--suggest | --direct] [--json]
                                      undo a merged token change against HEAD: conflicts shown, then a
                                      suggestion, or in direct mode a new local bridge/* branch (never pushes)
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
  bridge audit <path> --fix [--write] [--allowlist known.json] [--json]
                                      safe autofix: CSS values equal to a token become var(--token), with
                                      the audit's exceptions (ignore comments, --allowlist, audit.exclude).
                                      Dry run unless --write
  bridge snapshot [--out bridge-data] [--audit <path>[=label] ...] [--audit-report <file|dir> ...]
                 [--branch main] [--activity [--repo owner/name]] [--json]
                                      the repo model of this checkout for hosted Bridge (Studio and Library):
                                      snapshot.json (token, contrast and component files, Figma coverage,
                                      contrast results) plus audits/<id>.json. --audit runs bridge audit on a
                                      product folder; --audit-report carries reports already written.
                                      --activity also writes activity.json (open branches, suggestions,
                                      requests, recent merges, token history) read with GITHUB_TOKEN, so
                                      signed-out visitors of hosted Studio spend no GitHub API request.
                                      The bridge-data workflow publishes the folder to the bridge-data branch
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
  bridge build list [--filter all|waiting|in-progress|shipped-this-week] [--component Button] [--json]
  bridge build show <number> [--brief] [--json]
                                      build requests: structure changes pushed from Figma that developers
                                      build. Status read from GitHub (assignee, linked pull request), the
                                      brief for Claude (\`bridge build help\`)
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
  bridge pieces <n> [--record] | status <n> | open <n> <piece> | preview <n> <piece> | switch <n>
                                      a product branch and the library (\`bridge pieces help\`): what it adds
                                      that the library lacks, the library branch each piece opens (linked
                                      both ways), its preview in the product branch, the published version
  bridge suggestions [list | show <n> | link <n> --pr <m>] [--status approved] [--json]
                                      suggestions: changes filed as GitHub issues (label bridge-suggestion)
                                      that the owners approve and a developer applies (\`bridge suggestions help\`)
  bridge apply <n> [--write | --patch] [--dry-run] [--accept-edited] [--force-unapproved] [--json]
                                      apply suggestion #n on today's code: a new local branch (working tree
                                      untouched, nothing pushed), --write into the working tree, --patch for
                                      git am. Exit 0 applied or already applied, 1 not approved or blocked,
                                      2 usage, 3 conflict
  bridge review <n> --approve | --request-changes --message "..." | --decline --message "..."
                                      review a suggestion as its owner (counts only for owners in
                                      bridge.config.json, on the version you saw)
  bridge figma [show <n> | drafted <n> | push <diff.json>]
                                      component changes sent from Figma (\`bridge figma help\`): exact token
                                      changes and branches Claude AI drafts from the spec
  bridge products | bridge settings | bridge coverage [Component]
                                      products (and this folder's), Studio settings safe to read, which
                                      components are in Figma
  bridge docs save <Component> --file docs.json [--pr n] [--jira DS-42] [--product key] [--dry-run]
                                      save usage guidance as in the Library edit mode (GitHub token)
  bridge mcp [--root dir | --repo owner/name]   start the MCP server on stdio
  bridge --version | -v                 the CLI version.   bridge --help | -h   this help

Options:
  --root <dir>   repo root (default: current directory)
  --ds <dir>     audit: design system repo with bridge.config.json (default: --root, or the nearest one above)
  GITHUB_TOKEN   env (or BRIDGE_GITHUB_TOKEN), or --token <token>: the token bridge writes on GitHub with
                 (suggestions and requests need Issues: read and write; reviews, merges and pull requests need
                 Contents and Pull requests: read and write). Writes never use your gh sign-in on their own:
                 add --use-gh-auth for that. Reads (list, status, show) may use it and say so on stderr.
                 bridge mcp is the exception: like the MCP server, it falls back to your gh sign-in and says
                 so once at start, or says it runs without a token.
                 Never needed for local token work in direct mode, nor for --dry-run.
  --suggest | --direct   how a change reaches the code for this command (propose, brand create, revert,
                 docs save, pieces open, figma push). Default: "changes" in bridge.config.json, else suggest.

Exit codes (every command):
  0  done, or a clean dry run
  1  a rule said no: a check fails, a proposal or a merge is blocked, a suggestion is not approved yet
  2  usage or setup error: a missing or unknown argument, a bad git ref, a file not found, no token for a write
  3  bridge apply only: the suggestion conflicts with today's code
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
      const takesValue = inline === undefined && next !== undefined && !next.startsWith('--') && (fileArg || !['force', 'json', 'md', 'strict', 'dry-run', 'help', 'fix', 'write', 'no-regress', 'plan', 'keep-unchanged', 'restore-conflicts', 'breaking', 'claude', 'all', 'offline', 'approve', 'patch', 'accept-edited', 'force-unapproved', 'suggest', 'direct', 'use-gh-auth', 'measure', 'open', 'variants', 'check', 'tokens', 'shots', 'resume', 'no-fixes', 'case', 'with-claude', 'build', 'print', 'in-library'].includes(k));
      (out.flags[k] ??= []).push(inline ?? (takesValue ? argv[++i]! : 'true'));
    } else out._.push(a);
  }
  return out;
}
const flag = (a: Args, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: Args, k: string) => Boolean(a.flags[k]);
const print = (s: string) => process.stdout.write(`${s}\n`);
const modeArg = (s?: string) => (s ? Object.fromEntries(s.split(',').map((kv) => kv.split('=') as [string, string])) : undefined);
/** The context of a command: the token it may use (src/auth.ts), and messages in the words of the CLI. */
const context = (a: Args, root: string, access: Access) => cliContext(root, defaultIO(), a, access);
/** Where a change went: the suggestion filed, the branch opened, or why nothing was sent. */
function printSent(r: Record<string, any>) {
  if (r.status === 'suggested') print(`suggestion: #${r.number} ${r.url}`);
  if (r.message) print(String(r.message));
  if (r.branch && r.status !== 'suggested') print(`branch: ${r.branch}`);
  for (const w of r.warnings ?? []) print(`warning: ${w}`);
  if (r.next) print(String(r.next));
  if (r.hint) print(String(r.hint));
}

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
  // The measure is what lets Claude fix what differs in Figma: one more step, offered, never done behind the back.
  if (!existsSync(join(root, MEASURE_WORKFLOW_FILE))) print('\nTo let Claude fix what differs in Figma, turn on the automatic measure of your Storybook: bridge measure setup');
}

async function check(a: Args, root: string): Promise<number> {
  const ctx = await context(a, root, 'local');
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
  const ctx = await context(a, root, 'local');
  const limit = Number(flag(a, 'limit') ?? 20);
  if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit needs a whole number, e.g. --limit 50');
  const r = await ops.searchTokens(ctx, { query: q, limit });
  if (has(a, 'json')) return print(JSON.stringify(r, null, 2));
  if (!r.results.length) return print(`No token matches "${q}".`);
  const w = Math.max(...r.results.map((x) => x.path.length));
  for (const t of r.results) print(`${t.path.padEnd(w)}  ${String(t.value).padEnd(10)}  ${(t.tier ?? '').padEnd(9)}  ${t.description ?? ''}`);
  if (r.truncated) print(`\n${r.truncated}`);
}

/** Whether `ref` names a commit in the repo at `root` (a branch, a tag, HEAD~1, a sha). */
function gitRefExists(root: string, ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function diff(a: Args, root: string): Promise<number> {
  const base = a._[1];
  if (!base) throw new UsageError('bridge diff <base>   (a git ref: main, HEAD~1, a sha)');
  if (!gitRefExists(root, base)) throw new UsageError(`"${base}" is not a branch, tag or commit in ${root}. Pass a git ref: main, HEAD~1, a sha (\`git branch -a\` lists the branches).`);
  const ctx = await context(a, root, 'local');
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

const PICK_FILE_MCP = 'Pass "file" or "mode" (for example { "theme": "dark" }), or one edit per file.';
const PICK_FILE_CLI = 'Pass --file <file> or --mode theme=dark, or one edit per file in --edits edits.json.';

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
  if (editsFile) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(resolve(editsFile), 'utf8'));
    } catch (e) {
      const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
      throw new UsageError(`${editsFile} ${missing ? 'does not exist' : `is not valid JSON (${(e as Error).message})`}. Pass --edits with a JSON array of edits, for example [{ "op": "set", "path": "color.text.muted", "value": "{palette.neutral.700}", "mode": { "theme": "light" } }].`);
    }
    if (!Array.isArray(parsed)) throw new UsageError(`${editsFile} must hold a JSON array of edits, for example [{ "op": "set", "path": "color.text.muted", "value": "{palette.neutral.700}", "mode": { "theme": "light" } }].`);
    edits.push(...(parsed as Record<string, unknown>[]));
  }
  if (!edits.length) throw new UsageError('Give at least one --set path=value or --edits file.json');
  const pr = flag(a, 'pr');
  const changes = changesFlag(a);
  // Adding to a branch in review and filing a suggestion write on GitHub: only with a token passed on purpose.
  const ctx = await context(a, root, pr || changes !== 'direct' ? (has(a, 'dry-run') ? 'read' : 'write') : 'local');
  const summary = flag(a, 'summary');
  const branch = flag(a, 'branch');
  const jira = flag(a, 'jira');
  const product = flag(a, 'product');
  // The shared message names the MCP fields; say it with the CLI's flags.
  const r = (await ops
    .proposeTokenChange(ctx, {
      title,
      edits: edits as never,
      ...(summary ? { summary } : {}),
      ...(branch ? { branch } : {}),
      ...(pr ? { pr } : {}),
      ...(jira ? { jira } : {}),
      ...(product ? { product } : {}),
      ...(changes ? { changes } : {}),
      source: 'cli',
      dryRun: has(a, 'dry-run'),
    })
    .catch((e: Error) => {
      e.message = e.message.replace(PICK_FILE_MCP, PICK_FILE_CLI);
      throw e;
    })) as Record<string, any>;
  if (has(a, 'json')) print(JSON.stringify(r, null, 2));
  else {
    print(`status: ${r.status}${r.why ? ` (${r.why})` : ''}`);
    if (r.tier) print(`tier ${r.tier}, ${r.bump}`);
    for (const c of (r.changes as { kind: string; path: string; before?: string; after?: string }[]) ?? []) print(`  ${c.kind} ${c.path}: ${c.before ?? ''} -> ${c.after ?? ''}`);
    printSent(r);
    if (r.status === 'dry-run') print(`\n${r.suggestion?.body ?? r.prBody}`);
  }
  return r.status === 'blocked' ? 1 : 0;
}

async function brandCmd(a: Args, root: string): Promise<number> {
  const sub = a._[1];
  if (sub === 'help' || has(a, 'help')) return print(BRAND_HELP), 0;
  if (!sub) return print(BRAND_HELP), 2;
  const changes = changesFlag(a);
  const ctx = await context(a, root, sub === 'create' && changes !== 'direct' ? (has(a, 'dry-run') ? 'read' : 'write') : 'local');
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
    ...(changes ? { changes } : {}),
    source: 'cli',
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
  printSent(r);
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
  const ctx = await context(a, root, 'local');
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
  const changes = changesFlag(a);
  const ctx = await context(a, root, changes !== 'direct' ? (has(a, 'dry-run') ? 'read' : 'write') : 'local');
  const resolutions = Object.fromEntries((a.flags['use-before'] ?? []).map((k) => [k, 'use-before' as const]));
  const r = (await hist.proposeRevert(ctx, { target, resolutions, restoreConflicts: has(a, 'restore-conflicts'), dryRun: has(a, 'dry-run'), ...(changes ? { changes } : {}), source: 'cli' })) as Record<string, any>;
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
  printSent(r);
  if (r.status === 'dry-run') print(`\n${r.suggestion?.body ?? r.prBody}`);
  return r.status === 'blocked' ? 1 : 0;
}

async function audit(a: Args, root: string): Promise<number> {
  const target = a._[1];
  if (!target) throw new UsageError('bridge audit <path>   (a product folder or file that uses the design system)');
  if (!existsSync(target)) throw new UsageError(`No such file or folder: ${target}`);
  const dsRoot = flag(a, 'ds') ? resolve(flag(a, 'ds')!) : existsSync(join(root, CONFIG_FILE)) ? root : findDesignSystemRoot(root);
  if (!dsRoot) throw new UsageError(`No ${CONFIG_FILE} found: run bridge audit from the design system repo or pass --ds <dir>.`);
  const ds = loadDesignSystem(dsRoot);
  // The audit and its --fix read the same exceptions: --allowlist, ignore comments, audit.exclude in bridge.config.json.
  const allowlistPath = flag(a, 'allowlist');
  if (allowlistPath && !existsSync(allowlistPath)) throw new UsageError(`Allowlist not found: ${allowlistPath}`);
  let allowlist;
  try {
    allowlist = allowlistPath ? loadAllowlist(allowlistPath) : undefined;
  } catch (e) {
    throw new UsageError(`${allowlistPath}: ${(e as Error).message}`);
  }
  if (has(a, 'fix')) {
    const write = has(a, 'write');
    const changes = fixCss(target, ds.index, write, { exclude: ds.config.audit?.exclude ?? [], ...(allowlist ? { allowlist } : {}) });
    const n = changes.reduce((acc, c) => acc + c.edits.length, 0);
    const kept = changes.reduce((acc, c) => acc + c.kept.length, 0);
    const files = changes.filter((c) => c.edits.length).length;
    const said = n
      ? `${write ? 'Replaced' : 'Would replace'} ${n} value(s) in ${files} file(s) with exact token matches.${write ? '' : ' Run again with --write to apply.'}`
      : 'Nothing to fix: no CSS value equals a token exactly.';
    const keptLine = kept ? `Left as is on purpose: ${kept} value(s), by an ignore comment or the allowlist, as in the audit.` : '';
    if (has(a, 'json')) {
      print(JSON.stringify({ write, replaced: write ? n : 0, wouldReplace: write ? 0 : n, kept, files: changes, said }, null, 2));
      return 0;
    }
    for (const c of changes) for (const e of c.edits) print(`${c.file}:${e.line}:${e.column}  ${e.from} -> ${e.to}`);
    for (const c of changes) for (const k of c.kept) print(`${c.file}:${k.line}:${k.column}  ${k.from} kept (${k.via}: ${k.reason})`);
    print(said);
    if (keptLine) print(keptLine);
    return 0;
  }
  const baselinePath = flag(a, 'baseline');
  let baseline: AuditReport | undefined;
  if (baselinePath) {
    if (!existsSync(baselinePath)) throw new UsageError(`Baseline not found: ${baselinePath}`);
    try {
      baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as AuditReport;
    } catch (e) {
      throw new UsageError(`${baselinePath} is not valid JSON (${(e as Error).message}). Pass a report written by bridge audit <path> --json <file>.`);
    }
  }
  const label = flag(a, 'label');
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

async function snapshotCmd(a: Args, root: string): Promise<number> {
  const out = resolve(root, flag(a, 'out') ?? 'bridge-data');
  const branch = flag(a, 'branch');
  let activity: { token: string; repo?: string } | undefined;
  if (has(a, 'activity')) {
    // Reads only: GITHUB_TOKEN (in a workflow, the run token is enough), --token, or the gh sign-in (said on stderr).
    const token = chooseToken(a, defaultIO(), 'read').token;
    if (!token) throw new UsageError('bridge snapshot --activity reads GitHub: set GITHUB_TOKEN, pass --token <token>, or run gh auth login (in a workflow, the run token is enough).');
    const repo = flag(a, 'repo') || process.env.GITHUB_REPOSITORY || undefined;
    activity = { token, ...(repo ? { repo } : {}) };
  }
  const r = await writeSnapshot({ root, out, version: VERSION, audit: a.flags.audit ?? [], auditReports: a.flags['audit-report'] ?? [], ...(branch ? { branch } : {}), ...(activity ? { activity } : {}) });
  if (has(a, 'json'))
    print(
      JSON.stringify(
        {
          out,
          written: r.written,
          bytes: r.bytes,
          sourceSha: r.snapshot.sourceSha,
          summary: r.snapshot.summary,
          audits: r.snapshot.audits.map((x) => x.path),
          problems: r.snapshot.problems,
          ...(r.activity ? { activity: { bytes: r.activity.bytes, reads: Object.keys(r.activity.activity.responses).length, branches: r.activity.activity.branches.length, suggestions: r.activity.activity.suggestions.length, requests: r.activity.activity.requests.length, merged: r.activity.activity.merged.length, history: r.activity.activity.history?.entries.length ?? null, truncated: r.activity.activity.truncated, problems: r.activity.activity.problems } } : {}),
        },
        null,
        2,
      ),
    );
  else {
    const shown = relative(process.cwd(), out);
    for (const line of snapshotLines(r, shown.startsWith('..') || isAbsolute(shown) ? out : shown || '.')) print(line);
  }
  return 0;
}

const DOCS_HELP = `bridge docs: component usage guidance (Name.docs.json)

Usage:
  bridge docs draft <Component> [--json]
                     docs.json pre-fill from the code and a prompt for Claude to write the prose. Writes nothing
  bridge docs save <Component> --file docs.json [--pr <n>] [--title "..."] [--jira DS-42] [--product key]
                   [--suggest | --direct] [--dry-run] [--json]
                     save usage guidance as in the Library edit mode (GitHub token, see \`bridge --help\`)

Exit codes: 0 ok, 2 usage or setup error.`;

const BRAND_HELP = `bridge brand: brands (palette, radius, fonts) and new ones

Usage:
  bridge brand list [--json]
  bridge brand create <slug> --from bridge --primary <hex|hue> --neutral <hex|hue> [--name "Acme"] [--accent x]
                      [--link x] [--radius soft|balanced|crisp|i,c,co,o] [--heading font] [--text font]
                      [--notes "..."] [--suggest | --direct] [--dry-run] [--json]
                     generated ramps and the contrast gate for every theme, then a suggestion, or in direct
                     mode a new local bridge/brand-<slug> branch (never pushes, never main)

Exit codes: 0 ok, 1 blocked by the contrast gate, 2 usage or setup error.`;

async function docsCmd(a: Args, root: string): Promise<number> {
  const [, sub, name] = a._;
  if (sub === 'help' || has(a, 'help')) return print(DOCS_HELP), 0;
  if (!sub) return print(DOCS_HELP), 2;
  if (sub !== 'draft' || !name) throw new UsageError('Usage: bridge docs draft <Component> [--json]   (`bridge docs help` for docs save)');
  const ctx = await context(a, root, 'local');
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
  if (cmd === 'build') return runBuild(a, root);
  if (cmd === 'explore') return runExplore(a, root);
  if (cmd === 'branch') return runBranch(a, root);
  if (cmd === 'pieces') return runPieces(a, root);
  if (cmd === 'figma') return runFigma(a, root);
  if (cmd === 'specs') return runSpecs(a, root);
  if (cmd === 'fixes') return runFixes(a, root);
  if (cmd === 'gap') return runGap(a, root);
  if (cmd === 'gaps') return runGaps(a, root);
  if (cmd === 'fix') return runFix(a, root);
  if (cmd === 'measure') return runMeasure(a, root);
  if (cmd === 'suggestions' || cmd === 'suggest') return runSuggestions(a, root);
  if (cmd === 'apply') return runApply(a, root);
  if (cmd === 'review') return runReview(a, root);
  if (cmd === 'products' || cmd === 'settings' || cmd === 'coverage') return runStudioRead(cmd, a, root);
  if (cmd === 'docs' && a._[1] === 'save' && !has(a, 'help')) return runDocsSave(a, root);
  // `--version` and `-v` (no command) print the version; `history --version v` keeps its own meaning.
  if (cmd === 'version' || cmd === '-v' || (!cmd && has(a, 'version'))) return print(VERSION), 0;
  // Commands with their own help: `bridge docs --help`, `bridge brand --help`.
  if ((cmd === 'docs' || cmd === 'brand') && has(a, 'help')) return cmd === 'docs' ? docsCmd(a, root) : brandCmd(a, root);
  if (!cmd || has(a, 'help') || cmd === 'help' || cmd === '-h') {
    print(HELP);
    // Asked for (`help`, `--help`): exit 0. No command at all is a usage error: exit 2.
    return cmd || has(a, 'help') ? 0 : 2;
  }
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
    case 'snapshot':
      return snapshotCmd(a, root);
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
    // A write that went without a token the person passed: say how to pass one, in the CLI's words.
    const how = needsWriteToken(e.message) && !e.message.includes('--use-gh-auth') && !e.message.includes('--token') ? `\nTo write on GitHub, ${WRITE_TOKEN_HOW}.` : '';
    process.stderr.write(`bridge: ${e.message}${how}\n`);
    process.exitCode = 2;
  },
);
