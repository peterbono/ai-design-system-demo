// bridge connect: run once inside a product repository to connect it to the team's design system in Bridge. It writes
// the Bridge MCP server into .mcp.json (the same server designers add, pointed at the design system repository), the
// pointer .bridge/product.json (the design system and the product key), and a short Bridge section in CLAUDE.md (or
// AGENTS.md when that is the file the repository has). Idempotent: run again, only what differs changes, and nothing
// the team wrote is overwritten. After it, `bridge explore ...` and Claude work from this repository.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { productsOf, productRepoOf, type ProductConfig } from '@bridge-ds/core';
import { git, originRepo } from '@bridge-ds/core/node';
import { BridgeContext, GIT_CONFIG_KEYS, PRODUCT_POINTER, parseProductPointer, type ProductPointer } from '@bridge-ds/mcp';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';
import { chooseToken, CLI_TOKEN_HINT, READ_ONLY_REFUSAL } from './auth.js';

/** The MCP server on npm, the same one the docs give designers. */
export const MCP_PACKAGE = '@bridge-ds/mcp';

export const CONNECT_HELP = `bridge connect: connect this product repository to the team's design system in Bridge (run once here)

Usage:
  bridge connect --ds <owner/name> [--product <key>] [--dry-run] [--json]
                     writes .mcp.json (the Bridge MCP server for the design system <owner/name>),
                     ${PRODUCT_POINTER} (the design system and this product's key) and a short Bridge
                     section in CLAUDE.md (AGENTS.md when the repository only has that one; created when
                     neither exists). --product: the key in the design system's bridge.config.json
                     "products"; by default the product whose "repo" is this repository's origin.
                     Run it again any time: only what differs changes, your own content is kept.
                     In a React product it also prints the one line that mounts the Bridge toolbar
                     (@bridge-ds/toolbar: Before and After of a change, from Studio's Try it in the product).

Then, from this repository: bridge explore list | continue <#n> | start <name> | done <#n>, bridge pieces <#n>,
and Claude Code with the Bridge tools (restart it here once).`;

const flag = (a: RequestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

export const SECTION_START = '<!-- bridge:start -->';
export const SECTION_END = '<!-- bridge:end -->';

/** The Bridge section for CLAUDE.md or AGENTS.md: what Claude does in this product with the library. */
export function bridgeSection(x: { designSystem: string; product: ProductConfig | { key: string; name: string } }): string {
  const key = x.product.key;
  return [
    SECTION_START,
    '## Bridge design system',
    '',
    `This is ${x.product.name} (\`${key}\` in Bridge). Its UI uses the design system in [${x.designSystem}](https://github.com/${x.designSystem}), through the Bridge MCP server in \`.mcp.json\`. Set up by \`bridge connect\`; this section is rewritten when it runs again.`,
    '',
    '- Build screens with the library: look up components and tokens with the Bridge tools (`bridge_get_component`, `bridge_search_tokens`, `bridge_get_token`) before writing a component or a value. Never hardcode a value a token covers.',
    '- Explorations are free: when the designer wants to try something, start one with `bridge_start_exploration`, named from their words. No brief, no purpose needed.',
    `- "Continue Bridge exploration #12" (or ${key}#12): call \`bridge_continue_exploration\`. It switches this checkout to the \`explore/<name>\` branch when nothing is uncommitted, and says where it stands: start your answer with that.`,
    '- Work, commit and push on that branch. Never open a pull request to main from it, and never change the library from here.',
    '- At the end, the designer picks the pieces the library should get: `bridge_missing_pieces`, then Done exploring (`bridge_promote_exploration`) with the pieces they chose.',
    SECTION_END,
  ].join('\n');
}

/** The text with the Bridge section added at the end, or the one between the markers replaced. Everything else is kept. */
export function mergeSection(text: string | null, section: string): string {
  if (text === null || !text.trim()) return `${section}\n`;
  const start = text.indexOf(SECTION_START);
  const end = text.indexOf(SECTION_END, start);
  if (start >= 0 && end > start) return `${text.slice(0, start)}${section}${text.slice(end + SECTION_END.length)}`;
  return `${text.replace(/\s*$/, '')}\n\n${section}\n`;
}

/** The Bridge server entry for .mcp.json. */
export const mcpEntry = (designSystem: string) => ({ command: 'npx', args: ['-y', MCP_PACKAGE, '--repo', designSystem] });

export type FileChange = 'created' | 'updated' | 'unchanged' | 'kept';

export interface McpMerge {
  text: string;
  change: FileChange;
  /** Set when a different "bridge" server was there and is kept (run with --force to replace it). */
  note?: string;
}

/** .mcp.json with the Bridge server merged in. Other servers and keys are kept; a different "bridge" entry too, unless forced. */
export function mergeMcpJson(text: string | null, designSystem: string, force = false): McpMerge {
  const entry = mcpEntry(designSystem);
  let json: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
  if (text !== null && text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new RequestUsageError('.mcp.json is not valid JSON, so Bridge did not touch it. Fix it (or remove it), then run bridge connect again.');
    }
  }
  const servers = (json.mcpServers ?? {}) as Record<string, unknown>;
  const current = servers.bridge;
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(entry)) return { text: text!, change: 'unchanged' };
  if (current !== undefined && !force) {
    const args = (current as { args?: unknown[] }).args ?? [];
    const points = args.includes(designSystem);
    return {
      text: text!,
      change: 'kept',
      ...(points ? {} : { note: `.mcp.json already has a "bridge" server that does not name ${designSystem}. Kept it; run bridge connect --force to replace it.` }),
    };
  }
  json.mcpServers = { ...servers, bridge: entry };
  return { text: `${JSON.stringify(json, null, 2)}\n`, change: text === null ? 'created' : 'updated' };
}

async function readOrNull(path: string): Promise<string | null> {
  return existsSync(path) ? readFile(path, 'utf8') : null;
}

/** Which instructions file gets the section: CLAUDE.md, or AGENTS.md when the repository only has that one. */
export function instructionsFile(root: string): string {
  if (existsSync(join(root, 'CLAUDE.md'))) return 'CLAUDE.md';
  if (existsSync(join(root, 'AGENTS.md'))) return 'AGENTS.md';
  return 'CLAUDE.md';
}

/** The npm package of the Bridge toolbar. */
export const TOOLBAR_PACKAGE = '@bridge-ds/toolbar';

/** The one line a React product mounts at its root for Before and After (Studio's "Try it in the product"). */
export const toolbarMount = (designSystem: string, product: string) => `<BridgeToolbar ds="${designSystem}" product="${product}" />`;

export interface ToolbarSetup {
  /** installed: the package is a dependency; suggested: a React product without it (the lines say how); none: not React. */
  state: 'installed' | 'suggested' | 'none';
  /** What to run and paste: the install, the import and the mount (nothing is edited in the app). */
  lines: string[];
}

/**
 * Whether this product gets the Bridge toolbar and how: React by the design system's config ("framework": "react") or
 * by package.json (react in its dependencies). Bridge never edits the app's code: it prints the lines.
 */
export function toolbarSetup(pkgText: string | null, x: { designSystem: string; product: string; framework?: string | undefined }): ToolbarSetup {
  let deps: Record<string, unknown> = {};
  try {
    const pkg = pkgText ? (JSON.parse(pkgText) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }) : {};
    deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  } catch {
    deps = {};
  }
  const react = (x.framework ?? '').toLowerCase() === 'react' || 'react' in deps;
  if (!react) return { state: 'none', lines: [] };
  const mount = [`import { BridgeToolbar } from '${TOOLBAR_PACKAGE}';`, toolbarMount(x.designSystem, x.product)];
  if (TOOLBAR_PACKAGE in deps) return { state: 'installed', lines: mount };
  return { state: 'suggested', lines: [`npm i ${TOOLBAR_PACKAGE}`, ...mount] };
}

export interface ConnectResult {
  status: 'connected' | 'dry-run';
  designSystem: string;
  product: { key: string; name: string; repo?: string | undefined };
  files: { path: string; change: FileChange }[];
  /** The Bridge toolbar in a React product: installed, or the lines to add it. */
  toolbar: ToolbarSetup;
  warnings: string[];
  next: string;
}

/** Plans and (unless dryRun) writes the three files in `root`. `products` is the design system's list when it was read. */
export async function connect(root: string, a: { designSystem: string; product?: string | undefined; products: ProductConfig[] | null; origin: string | null; force?: boolean; dryRun?: boolean }): Promise<ConnectResult> {
  const warnings: string[] = [];
  const pointerPath = join(root, PRODUCT_POINTER);
  const oldPointer = await readOrNull(pointerPath);
  let previous: ProductPointer | null = null;
  try {
    previous = oldPointer ? parseProductPointer(oldPointer) : null;
  } catch {
    previous = null;
  }
  const wanted = a.product ?? (previous && previous.designSystem.toLowerCase() === a.designSystem.toLowerCase() ? previous.product : undefined);
  let product: { key: string; name: string; repo?: string | undefined };
  let found: ProductConfig | undefined;
  if (a.products) {
    const byKey = wanted ? a.products.find((p) => p.key === wanted || p.name.toLowerCase() === wanted.toLowerCase()) : undefined;
    const byRepo = a.origin ? a.products.find((p) => productRepoOf(p, a.designSystem)?.toLowerCase() === a.origin!.toLowerCase()) : undefined;
    found = wanted ? byKey : byRepo;
    if (!found) {
      const list = a.products.map((p) => `${p.key} (${p.name})`).join(', ');
      throw new RequestUsageError(
        wanted
          ? `The design system ${a.designSystem} has no product "${wanted}". Products: ${list}. Pass one with --product <key>.`
          : `No product in ${a.designSystem} has this repository (${a.origin ?? 'no origin remote'}) as its "repo". Pass --product <key>: ${list}. An admin adds the product to bridge.config.json "products" first when it is not there.`,
      );
    }
    product = { key: found.key, name: found.name, repo: productRepoOf(found, a.designSystem) ?? undefined };
    if (!product.repo) warnings.push(`${found.name} has no "repo" in the design system's bridge.config.json, so its explorations are created in ${a.designSystem}. An admin can add "repo": "${a.origin ?? 'owner/name'}" to that product.`);
    else if (a.origin && product.repo.toLowerCase() !== a.origin.toLowerCase()) warnings.push(`${found.name} is set to ${product.repo} in the design system, but this checkout's origin is ${a.origin}.`);
  } else {
    if (!wanted) throw new RequestUsageError(`Bridge could not read ${a.designSystem}'s bridge.config.json to find this product. Pass --product <key>, or check the name and your access.`);
    product = { key: wanted, name: wanted };
    warnings.push(`Bridge could not read ${a.designSystem}'s bridge.config.json, so the product "${wanted}" is not checked.`);
  }

  const pointer: ProductPointer = { version: 1, designSystem: a.designSystem, product: product.key };
  const pointerText = `${JSON.stringify(pointer, null, 2)}\n`;
  const mcpPath = join(root, '.mcp.json');
  const mcp = mergeMcpJson(await readOrNull(mcpPath), a.designSystem, a.force);
  if (mcp.note) warnings.push(mcp.note);
  const docName = instructionsFile(root);
  const docPath = join(root, docName);
  const oldDoc = await readOrNull(docPath);
  const doc = mergeSection(oldDoc, bridgeSection({ designSystem: a.designSystem, product }));

  const changeOf = (old: string | null, next: string): FileChange => (old === null ? 'created' : old === next ? 'unchanged' : 'updated');
  const files: { path: string; change: FileChange; abs: string; text: string }[] = [
    { path: '.mcp.json', change: mcp.change, abs: mcpPath, text: mcp.text },
    { path: PRODUCT_POINTER, change: changeOf(oldPointer, pointerText), abs: pointerPath, text: pointerText },
    { path: docName, change: changeOf(oldDoc, doc), abs: docPath, text: doc },
  ];
  if (!a.dryRun) {
    for (const f of files) {
      if (f.change !== 'created' && f.change !== 'updated') continue;
      await mkdir(dirname(f.abs), { recursive: true });
      await writeFile(f.abs, f.text);
    }
    // The same link in this clone's git config: Bridge still finds it on a branch made before these files were
    // committed (an exploration started earlier), where .bridge/product.json is not.
    if (existsSync(join(root, '.git'))) {
      await git(root, ['config', '--local', GIT_CONFIG_KEYS.designSystem, pointer.designSystem]).catch(() => '');
      await git(root, ['config', '--local', GIT_CONFIG_KEYS.product, pointer.product]).catch(() => '');
    }
  }
  const changed = files.filter((f) => f.change === 'created' || f.change === 'updated').map((f) => f.path);
  const toolbar = toolbarSetup(await readOrNull(join(root, 'package.json')), { designSystem: a.designSystem, product: product.key, framework: found?.framework });
  if (toolbar.state !== 'none' && found && !found.production && !found.path) {
    warnings.push(`${found.name} has no "production" URL in the design system's bridge.config.json, so the Bridge toolbar cannot show Live product for a change made here. An admin can add "production": "https://..." to that product.`);
  }
  return {
    status: a.dryRun ? 'dry-run' : 'connected',
    designSystem: a.designSystem,
    product,
    files: files.map(({ path, change }) => ({ path, change })),
    toolbar,
    warnings,
    next: changed.length
      ? `Commit ${changed.join(', ')} so everyone working here gets it. Restart Claude Code in this folder to load the Bridge tools. Then: bridge explore list, or "Continue Bridge exploration #<n>" in Claude.`
      : 'Already connected, nothing changed. bridge explore list shows this product\'s explorations.',
  };
}

const VERB: Record<FileChange, string> = { created: 'Created', updated: 'Updated', unchanged: 'Unchanged', kept: 'Kept' };
const WHAT: Record<string, string> = { '.mcp.json': 'the Bridge MCP server', [PRODUCT_POINTER]: 'the design system and product key' };

export async function runConnect(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  if (has(a, 'help') || a._[1] === 'help') return io.print(CONNECT_HELP), 0;
  const ds = (flag(a, 'ds') ?? a._[1] ?? '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ds)) throw new RequestUsageError(`Usage: bridge connect --ds <owner/name> [--product <key>]. --ds is the team's design system repository.\n\n${CONNECT_HELP}`);
  if (existsSync(join(root, 'bridge.config.json'))) throw new RequestUsageError('This folder has a bridge.config.json: it is a design system repository, not a product. Run bridge connect inside the product repository.');
  // Read the design system's products (a read: the gh sign-in may be borrowed, and it then refuses any write).
  const { token, origin } = chooseToken(a, io, 'read');
  let products: ProductConfig[] | null = null;
  try {
    const ctx = await BridgeContext.create({ repo: ds, ...(token ? { token } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(origin === 'gh' && !a.flags['use-gh-auth'] ? { readOnly: READ_ONLY_REFUSAL } : {}), surface: 'cli', tokenHint: CLI_TOKEN_HINT });
    const { config, origin: from } = await ctx.config();
    products = from === 'file' ? productsOf(config) : null;
  } catch {
    products = null;
  }
  const here = await originRepo(root).catch(() => undefined);
  const r = await connect(root, { designSystem: ds, product: flag(a, 'product'), products, origin: here ?? null, force: has(a, 'force'), dryRun: has(a, 'dry-run') });
  if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
  io.print(`${r.status === 'dry-run' ? 'Dry run, nothing written. ' : ''}${r.status === 'dry-run' ? 'Would connect' : 'Connected'} ${r.product.name} (${r.product.key}) to the design system ${r.designSystem}.`);
  for (const f of r.files) io.print(`  ${VERB[f.change]} ${f.path}${f.change === 'unchanged' || f.change === 'kept' ? '' : `: ${WHAT[f.path] ?? 'a short Bridge section for Claude'}`}`);
  if (r.toolbar.state === 'suggested') {
    io.print(`\nBefore and after in ${r.product.name} (Studio's Try it in the product): add the Bridge toolbar, then mount it once at the root of the app, inside ThemeProvider. Bridge does not edit your code.`);
    for (const l of r.toolbar.lines) io.print(`  ${l}`);
  } else if (r.toolbar.state === 'installed') {
    io.print(`\nThe Bridge toolbar is installed: mount it once at the root of the app, if it is not yet.`);
    for (const l of r.toolbar.lines) io.print(`  ${l}`);
  }
  for (const w of r.warnings) io.error(`Warning: ${w}`);
  io.print(`\n${r.next}`);
  return 0;
}
