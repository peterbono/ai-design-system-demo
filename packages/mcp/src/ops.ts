// Every Bridge operation as a plain async function. The MCP server and the CLI are thin wrappers over these.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { buildAuditReport, compareWithBaseline, DesignSystemIndex, type AuditReport } from '@bridge-ds/core/audit';
import { auditSnippet } from './audit.js';
import { cssVarsUsed, getComponent, listComponentNames, listComponents, scaffoldComponent, type ScaffoldInput } from './components.js';
import type { BridgeContext } from './context.js';
import { baseBranchOf, cssModuleClasses, docsPrompt, prefillDocs, protectedBranchesOf, type DocsContrastInput } from '@bridge-ds/core';
import { branchExists, collectAuditFiles, commitToNewLocalBranch, currentBranch, git } from '@bridge-ds/core/node';
import { core, type Combo, type Issue, type PairInput, type TokenEdit, type TokenSet } from './core-adapter.js';
import { bullets, findSection, toc } from './markdown.js';
import { GitHubSource, GitRefSource, type RepoSource } from './source.js';

const prefixPath = (set: TokenSet, f: string) => set.repoPath(f);

/** Accepts `color.text.muted`, `--color-text-muted` or `var(--color-text-muted)`. */
export function normalizeTokenPath(set: TokenSet, input: string): string {
  const s = input.trim().replace(/^var\(\s*/, '').replace(/\s*\)$/, '').replace(/^\{|\}$/g, '');
  if (s.startsWith(set.config.cssVar.prefix) && !set.allPaths().includes(s)) {
    const hit = set.allPaths().find((p) => set.cssVarName(p) === s);
    if (hit) return hit;
  }
  return s;
}

// --- config ---------------------------------------------------------------------------------------------

export async function getConfig(ctx: BridgeContext) {
  const { config, origin } = await ctx.config();
  const set = await ctx.tokens();
  const gh = await ctx.github().catch(() => null);
  const tiers = Object.fromEntries(Object.keys(config.tokens.tiers).map((t) => [t, set.defs.filter((d) => set.tierOfFile(d.file) === t).length]));
  return {
    source: ctx.describe(),
    configOrigin: origin === 'file' ? 'bridge.config.json' : 'detected (no bridge.config.json; run `bridge init` to pin it)',
    write: ctx.mode === 'local' ? (ctx.isGit ? 'local branches only (never pushes)' : 'none (not a git repo)') : ctx.canWriteRemote ? 'pull requests on new bridge/* branches' : 'read-only (set GITHUB_TOKEN to open PRs)',
    repo: gh ? gh.fullName : null,
    tokenFiles: set.fileNames.length,
    tokens: set.allPaths().length,
    tokensPerTier: tiers,
    modes: config.axes,
    modeCombinations: set.combos().length,
    config,
  };
}

// --- tokens ---------------------------------------------------------------------------------------------

export async function listTokens(ctx: BridgeContext, a: { tier?: string; type?: string; prefix?: string; mode?: Partial<Combo>; limit?: number; offset?: number }) {
  const set = await ctx.tokens();
  const combo = set.normalizeCombo(a.mode);
  const view = set.view(combo);
  const rows = [...view.entries()]
    .map(([path, defs]) => ({ path, def: defs[defs.length - 1]! }))
    .filter(({ path }) => (!a.prefix || path === a.prefix || path.startsWith(`${a.prefix.replace(/\.$/, '')}.`)) && (!a.tier || set.tierOf(path) === a.tier))
    .map(({ path, def }) => {
      const r = set.resolve(path, combo);
      return { path, type: r.type, tier: set.tierOf(path), value: r.error ? `ERROR: ${r.error}` : r.css, ...(typeof def.value === 'string' && def.value.startsWith('{') ? { alias: def.value } : {}) };
    })
    .filter((r) => !a.type || r.type === a.type)
    .sort((x, y) => x.path.localeCompare(y.path));
  const offset = a.offset ?? 0;
  const limit = a.limit ?? 100;
  return { mode: combo, total: rows.length, offset, returned: Math.min(limit, Math.max(0, rows.length - offset)), tokens: rows.slice(offset, offset + limit), ...(rows.length > offset + limit ? { next: `offset ${offset + limit}` } : {}) };
}

async function componentCss(ctx: BridgeContext, set: TokenSet): Promise<{ component: string; file: string; text: string }[]> {
  const dir = set.config.components?.dir;
  if (!dir) return [];
  const files = (await ctx.source.list(dir)).filter((f) => f.endsWith('.css'));
  return (await Promise.all(files.map(async (f) => ({ component: f.slice(dir.length + 1).split('/')[0]!, file: f, text: (await ctx.source.read(f)) ?? '' })))).filter((x) => x.text);
}

export async function getToken(ctx: BridgeContext, a: { path: string }) {
  const set = await ctx.tokens();
  const path = normalizeTokenPath(set, a.path);
  const defs = set.defsOf(path);
  if (!defs.length) {
    const near = set.allPaths().filter((p) => p.includes(path.split('.').pop() ?? path)).slice(0, 10);
    throw new Error(`No token "${a.path}".${near.length ? ` Close: ${near.join(', ')}.` : ''} Use bridge_search_tokens.`);
  }
  // Values per mode combination, collapsed where they agree.
  const groups = new Map<string, { value: string; chain: string[]; modes: string[] }>();
  for (const combo of set.combos()) {
    if (!set.view(combo).has(path)) continue;
    const r = set.resolve(path, combo);
    const value = r.error ? `ERROR: ${r.error}` : r.css;
    const k = `${value}|${r.chain.join('>')}`;
    const g = groups.get(k);
    if (g) g.modes.push(core.comboKey(combo));
    else groups.set(k, { value, chain: r.chain, modes: [core.comboKey(combo)] });
  }
  const total = set.combos().length;
  const values = [...groups.values()].map((g) => ({ ...g, modes: g.modes.length === total ? ['all'] : g.modes }));
  // Usage: this token's CSS variable, and the variables of tokens that alias it (component tier).
  const referencedBy = set.referencedBy(path).filter((r) => r.path !== path);
  const aliasers = new Set<string>();
  const queue = [path];
  for (let depth = 0; depth < 3 && queue.length; depth++) {
    for (const p of queue.splice(0)) for (const r of set.referencedBy(p)) if (r.path !== path && !aliasers.has(r.path)) (aliasers.add(r.path), queue.push(r.path));
  }
  const css = await componentCss(ctx, set);
  const direct = set.cssVarName(path);
  const usedIn: { component: string; file: string; via?: string }[] = [];
  for (const c of css) {
    if (new RegExp(`var\\(\\s*${direct}\\s*[,)]`).test(c.text)) usedIn.push({ component: c.component, file: c.file });
    else {
      const via = [...aliasers].find((p) => new RegExp(`var\\(\\s*${set.cssVarName(p)}\\s*[,)]`).test(c.text));
      if (via) usedIn.push({ component: c.component, file: c.file, via });
    }
  }
  return {
    path,
    cssVar: set.cssVarName(path),
    type: set.resolve(path, set.combos().find((c) => set.view(c).has(path)) ?? set.defaultCombo).type,
    tier: set.tierOf(path),
    ...(defs.find((d) => d.description) ? { description: defs.find((d) => d.description)!.description } : {}),
    definedIn: defs.map((d) => ({ file: prefixPath(set, d.file), tier: set.tierOfFile(d.file), value: d.value })),
    values,
    referencedBy: referencedBy.map((r) => r.path),
    usedIn,
  };
}

export async function searchTokens(ctx: BridgeContext, a: { query: string; type?: string; limit?: number }) {
  const set = await ctx.tokens();
  const combo = set.defaultCombo;
  const q = a.query.trim().toLowerCase();
  const terms = q.split(/[\s.,/-]+/).filter(Boolean);
  const qColor = core.toRgba(q);
  const scored = set.allPaths().flatMap((path) => {
    const r = set.resolve(path, combo);
    if (a.type && r.type !== a.type) return [];
    const desc = (set.defsOf(path).find((d) => d.description)?.description ?? '').toLowerCase();
    const p = path.toLowerCase();
    let score = 0;
    if (p === q || set.cssVarName(path) === q) score += 100;
    if (r.css.toLowerCase() === q) score += 60;
    if (qColor && r.type === 'color') {
      const c = core.toRgba(r.value);
      if (c) {
        const d = Math.hypot(c.r - qColor.r, c.g - qColor.g, c.b - qColor.b);
        if (d < 0.004) score += 50;
        else if (d < 0.06) score += 20 - d * 200;
      }
    }
    for (const t of terms) {
      if (p.split('.').includes(t)) score += 12;
      else if (p.includes(t)) score += 6;
      if (desc.includes(t)) score += 3;
    }
    if (terms.length > 1 && terms.every((t) => p.includes(t) || desc.includes(t))) score += 10;
    if (!score) return [];
    return [{ path, score: Math.round(score), type: r.type, tier: set.tierOf(path), value: r.css, ...(desc ? { description: set.defsOf(path).find((d) => d.description)!.description } : {}) }];
  });
  scored.sort((x, y) => y.score - x.score || x.path.localeCompare(y.path));
  return { query: a.query, mode: combo, total: scored.length, results: scored.slice(0, a.limit ?? 20) };
}

// --- checks ---------------------------------------------------------------------------------------------

async function withEdits(ctx: BridgeContext, edits?: TokenEdit[]) {
  const before = await ctx.tokens();
  if (!edits?.length) return { before, after: before, touched: [] as string[], notes: [] as string[] };
  const r = core.applyEdits(before, edits);
  return { before, after: core.tokenSetFromFiles(before.config, r.files), touched: r.touched, notes: r.notes };
}

export async function checkContrast(ctx: BridgeContext, a: { edits?: TokenEdit[]; pairs?: PairInput[]; mode?: Partial<Combo>; includePassing?: boolean }) {
  const { before, after, notes } = await withEdits(ctx, a.edits);
  const pairs = a.pairs?.length ? core.toPairs(a.pairs) : await core.readContrastPairs(ctx.source, after.config);
  if (!pairs.length) return { pairs: 0, message: 'No contrast pairs: add contrast.path to bridge.config.json or pass pairs.' };
  const modes = after.config.contrast?.modes;
  const filter = (rs: ReturnType<typeof core.runContrast>) => (a.mode ? rs.filter((r) => Object.entries(a.mode!).every(([k, v]) => r.modes.split(',').includes(`${k}=${v}`))) : rs);
  const afterRes = filter(core.runContrast(after, pairs, modes));
  const failing = afterRes.filter((r) => !r.pass);
  const tightest = [...afterRes].filter((r) => r.ratio !== null).sort((x, y) => x.ratio! - x.min - (y.ratio! - y.min)).slice(0, 5);
  const base = {
    source: a.pairs?.length ? 'pairs given' : after.config.contrast?.path,
    checks: afterRes.length,
    failing: failing.length,
    failures: failing,
    tightest: tightest.map((r) => ({ pair: `${r.fg} on ${r.bg}`, modes: r.modes, ratio: r.ratio, min: r.min })),
    ...(a.includePassing ? { results: afterRes } : {}),
  };
  if (!a.edits?.length) return base;
  const beforeRes = filter(core.runContrast(before, pairs, modes));
  const delta = core.contrastDelta(beforeRes, afterRes);
  return { ...base, edits: a.edits.length, notes, changed: delta, newFailures: delta.filter((d) => d.passBefore && !d.passAfter) };
}

const issueKey = (i: Issue) => `${i.code}|${i.path ?? ''}|${i.file ?? ''}|${i.message}`;

export async function validateTokens(ctx: BridgeContext, a: { edits?: TokenEdit[]; includeWarnings?: boolean }) {
  const { before, after, notes } = await withEdits(ctx, a.edits);
  const issues = core.validate(after);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const res = {
    valid: errors.length === 0,
    files: after.fileNames.length,
    tokens: after.allPaths().length,
    modeCombinations: after.combos().length,
    errors,
    warningCount: warnings.length,
    ...(a.includeWarnings ? { warnings } : warnings.length ? { warningSample: warnings.slice(0, 5) } : {}),
  };
  if (!a.edits?.length) return res;
  const prev = new Set(core.validate(before).map(issueKey));
  return { ...res, notes, newErrors: errors.filter((i) => !prev.has(issueKey(i))) };
}

// --- components and docs ----------------------------------------------------------------------------------

export async function listComponentsOp(ctx: BridgeContext, a: { withSummaries?: boolean; family?: string }) {
  const { config } = await ctx.config();
  if (!config.components) return { components: [], message: 'No components.dir in bridge.config.json.' };
  const list = await listComponents(ctx.source, config, a.withSummaries ?? ctx.mode === 'local');
  const filtered = a.family ? list.filter((c) => c.family?.toLowerCase() === a.family!.toLowerCase()) : list;
  return { dir: config.components.dir, total: filtered.length, components: filtered };
}

export async function getComponentOp(ctx: BridgeContext, a: { name: string; include?: string[] }) {
  const { config } = await ctx.config();
  if (!config.components) throw new Error('No components.dir in bridge.config.json.');
  const set = await ctx.tokens();
  const c = await getComponent(ctx.source, config, set, a.name);
  if (a.include?.length && c.docs) {
    const keep = new Set(a.include);
    c.docs = Object.fromEntries(Object.entries(c.docs).filter(([k]) => keep.has(k)));
  }
  return c;
}

const NATIVE_ELEMENTS: Record<string, string> = { Button: 'button', Input: 'input', Span: 'span', Div: 'div', Anchor: 'a', TextArea: 'textarea', Select: 'select', UList: 'ul', Paragraph: 'p', Heading: 'h2', Label: 'label', Image: 'img' };

/** `ButtonHTMLAttributes<HTMLButtonElement>` -> button. Anything else (another component's props) -> undefined. */
function nativeElementOf(ext?: string): string | undefined {
  const m = ext && /<HTML(\w*)Element>/.exec(ext);
  if (!m) return undefined;
  return NATIVE_ELEMENTS[m[1]!] ?? (m[1] ? m[1].toLowerCase() : 'element');
}

/** JSDoc right above `export const|function Name`, flattened to one line. */
function jsdocOf(src: string, name: string): string | undefined {
  const m = new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*export (?:const|function) ${name}\\b`).exec(src);
  return m?.[1]?.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim() || undefined;
}

/**
 * bridge_draft_docs: the deterministic pre-fill of a component's docs.json (props table, tokens, anatomy from the
 * CSS module classes, contrast notes, changelog line, existing prose kept) and a prompt for the user's own Claude
 * to write the prose that code cannot tell. Nothing is written.
 */
export async function draftDocsOp(ctx: BridgeContext, a: { name: string }) {
  const { config } = await ctx.config();
  if (!config.components) throw new Error('No components.dir in bridge.config.json.');
  const set = await ctx.tokens();
  const c = await getComponent(ctx.source, config, set, a.name);
  const dir = `${config.components.dir}/${c.name}`;
  const pick = (re: RegExp) => c.files.find((f) => re.test(f.split('/').pop()!));
  const tsxPath = pick(new RegExp(`^${c.name}\\.(tsx|ts|vue|svelte)$`));
  const cssPath = pick(new RegExp(`^${c.name}${config.components.styleSuffix.replace(/\./g, '\\.')}$`)) ?? pick(/\.css$/);
  const [src, css] = await Promise.all([tsxPath ? ctx.source.read(tsxPath) : null, cssPath ? ctx.source.read(cssPath) : null]);
  const known = new Map(set.allPaths().map((p) => [set.cssVarName(p), p] as const));
  const own = c.tokens.used.filter((v) => known.has(v));
  // Another component's stylesheet imported by this one (IconButton reads Button.module.css): its tokens count apart.
  const inheritedTokens: Record<string, string[]> = {};
  const suffix = config.components.styleSuffix.replace(/\./g, '\\.');
  for (const m of (src ?? '').matchAll(new RegExp(`from\\s+['"]\\.\\./(\\w+)/(\\w+)${suffix}['"]`, 'g'))) {
    const other = await ctx.source.read(`${config.components.dir}/${m[1]}/${m[2]}${config.components.styleSuffix}`);
    if (!other) continue;
    const extra = cssVarsUsed(other).filter((v) => known.has(v) && !own.includes(v));
    if (extra.length) inheritedTokens[m[1]!] = extra;
  }
  // Contrast pairs of the gate that involve a token this component reads, worst ratio over every mode.
  const paths = new Set([...own, ...Object.values(inheritedTokens).flat()].map((v) => known.get(v)!));
  const pairs = (await core.readContrastPairs(ctx.source, config).catch(() => [])).filter((p) => paths.has(p.foreground) || paths.has(p.background));
  const contrast: DocsContrastInput[] = [];
  if (pairs.length) {
    const worst = new Map<string, DocsContrastInput>();
    for (const r of core.runContrast(set, pairs, config.contrast?.modes)) {
      if (r.ratio === null) continue;
      const key = `${r.fg}|${r.bg}`;
      const prev = worst.get(key);
      if (!prev || r.ratio < prev.ratio) worst.set(key, { foreground: r.fg, background: r.bg, ratio: r.ratio, min: r.min });
    }
    contrast.push(...worst.values());
  }
  const existing = c.docs && !('error' in c.docs) ? (c.docs as Record<string, unknown>) : null;
  const description = src ? jsdocOf(src, c.name) : undefined;
  const prefill = prefillDocs({
    name: c.name,
    description,
    props: c.props.map((p) => ({ name: p.name, type: p.type, required: !p.optional, defaultValue: p.default, description: p.description })),
    inherits: nativeElementOf((c as { extends?: string }).extends),
    tokens: own,
    inheritedTokens,
    cssClasses: css ? cssModuleClasses(css) : [],
    contrast,
    existing,
  });
  const read = async (path?: string) => (path ? ((await ctx.source.read(path)) ?? undefined) : undefined);
  const designLanguage = await read(config.docs.designLanguage);
  const ref = config.components.reference;
  const path = `${dir}/${c.name}${config.components.docsSuffix}`;
  const prompt = docsPrompt(prefill, {
    agents: await read(config.docs.guidelines),
    voice: designLanguage ? findSection(designLanguage, 'voice')[0]?.body : undefined,
    example: ref && ref !== c.name ? await read(`${config.components.dir}/${ref}/${ref}${config.components.docsSuffix}`) : undefined,
    source: src ?? undefined,
  });
  return {
    component: c.name,
    path,
    exists: Boolean(existing),
    prefill,
    prompt,
    instruction: `Write the prose from \`prompt\`, set "draftedBy": "claude" and "needsReview": true, and save the JSON to ${path}. A reviewer accepts it in Bridge Studio (Changes, Docs) before needsReview turns false.`,
  };
}

async function readDoc(ctx: BridgeContext, path: string | undefined, label: string) {
  if (!path) throw new Error(`No ${label} configured (docs in bridge.config.json).`);
  const text = await ctx.source.read(path);
  if (text === null) throw new Error(`${path} not found.`);
  return text;
}

export async function getDesignLanguage(ctx: BridgeContext, a: { section?: string }) {
  const { config } = await ctx.config();
  const md = await readDoc(ctx, config.docs.designLanguage, 'design language');
  if (!a.section) return { file: config.docs.designLanguage, sections: toc(md), hint: 'Pass section (number, title or slug) for its text, or "all".' };
  if (a.section === 'all') return { file: config.docs.designLanguage, text: md };
  const hits = findSection(md, a.section);
  if (!hits.length) return { file: config.docs.designLanguage, error: `No section matches "${a.section}".`, sections: toc(md) };
  return { file: config.docs.designLanguage, text: hits[0]!.body, ...(hits.length > 1 ? { otherMatches: hits.slice(1).map((h) => h.title) } : {}) };
}

export async function getGuidelines(ctx: BridgeContext, a: { section?: string }) {
  const { config } = await ctx.config();
  const md = await readDoc(ctx, config.docs.guidelines, 'guidelines (AGENTS.md)');
  if (a.section && a.section !== 'rules') {
    if (a.section === 'all') return { file: config.docs.guidelines, text: md };
    const hits = findSection(md, a.section);
    return hits.length ? { file: config.docs.guidelines, text: hits[0]!.body } : { file: config.docs.guidelines, error: `No section matches "${a.section}".`, sections: toc(md) };
  }
  const rule = (name: string) => bullets(findSection(md, name)[0]?.body ?? '');
  let tiers: string | undefined;
  if (config.docs.governance) {
    const gov = await ctx.source.read(config.docs.governance);
    tiers = gov ? findSection(gov, 'risk tiers')[0]?.body : undefined;
  }
  return {
    file: config.docs.guidelines,
    always: rule('always'),
    askBefore: rule('ask before'),
    never: rule('never'),
    tokenConventions: rule('token conventions'),
    ...(tiers ? { riskTiers: tiers } : {}),
    bridgeEnforces: [
      'Proposals never touch the base branch or main: new bridge/* branch, then a pull request (remote) or a local branch (local).',
      'Any token added, changed, renamed or removed is Tier 3: draft PR, design and tech owner approval. A description-only change is Tier 1 (patch).',
      'A proposal that adds validation errors or breaks a contrast pair is blocked, not opened.',
      'Without a GitHub token the server is read-only.',
    ],
    sections: toc(md),
  };
}

// --- proposals ------------------------------------------------------------------------------------------

export async function proposeTokenChange(ctx: BridgeContext, a: { edits: TokenEdit[]; title: string; summary?: string; dryRun?: boolean }) {
  if (!a.edits?.length) throw new Error('Pass at least one edit.');
  const { config } = await ctx.config();
  const { before, after, touched, notes } = await withEdits(ctx, a.edits);
  const changes = core.diff(before, after);
  if (!changes.length) return { status: 'no-change', message: 'The edits leave every token as it was.' };

  const prevErrors = new Set(core.validate(before).map(issueKey));
  const newErrors = core.validate(after).filter((i) => i.level === 'error' && !prevErrors.has(issueKey(i)));
  const pairs = await core.readContrastPairs(ctx.source, config).catch(() => []);
  const delta = pairs.length ? core.contrastDelta(core.runContrast(before, pairs, config.contrast?.modes), core.runContrast(after, pairs, config.contrast?.modes)) : [];
  const newFailures = delta.filter((d) => d.passBefore && !d.passAfter);
  const imp = core.impact(before, after, changes);
  const tier = core.classify(changes, [], config);
  const summary = a.summary?.trim() || a.title;
  const body = core.prBody({ summary, changes, contrast: delta, impact: imp, tier, validationErrors: newErrors.length, tool: 'Bridge MCP' });
  const slugTitle = core.slugify(a.title);
  const changesetPath = `${config.changesets?.dir ?? '.changeset'}/bridge-${slugTitle}.md`;
  const files = [
    ...touched.map((f) => ({ path: prefixPath(after, f), content: after.files.get(f)! as string | null })),
    ...(config.changesets ? [{ path: changesetPath, content: core.changeset(config.changesets.package, tier.bump, summary) }] : []),
  ];
  const report = {
    title: a.title,
    tier: tier.tier,
    bump: tier.bump,
    reasons: tier.reasons,
    changes: changes.map((c) => ({ kind: c.kind, path: c.path, ...(c.from ? { from: c.from } : {}), file: prefixPath(after, c.file), before: c.beforeCss, after: c.afterCss, ...(c.fields.length ? { fields: c.fields } : {}) })),
    contrast: { moved: delta.length, newFailures },
    impact: { total: imp.total, sample: imp.entries.slice(0, 10) },
    notes,
  };
  if (newErrors.length || newFailures.length) {
    return { status: 'blocked', why: [newErrors.length ? `${newErrors.length} new validation error(s)` : '', newFailures.length ? `${newFailures.length} contrast pair(s) would fail` : ''].filter(Boolean).join(' and '), newErrors, ...report, hint: 'Fix the edits (or add edits for the aliases they break). Bridge never opens a PR that breaks the gate.' };
  }
  let branch = `${config.governance.branchPrefix}${slugTitle}`;
  const preview = { ...report, branch, files: files.map((f) => f.path), prBody: body };
  if (a.dryRun) return { status: 'dry-run', ...preview, fileContents: files };

  if (ctx.mode === 'local') {
    if (!ctx.isGit) return { status: 'preview', message: 'Not a git repo: nothing written. Apply fileContents yourself.', ...preview, fileContents: files };
    const protectedBranches = [...new Set([...protectedBranchesOf(config), baseBranchOf(config)])];
    for (let i = 2; await branchExists(ctx.root!, branch); i++) branch = `${config.governance.branchPrefix}${slugTitle}-${i}`;
    const base = await currentBranch(ctx.root!);
    const message = `${tier.bump === 'major' ? 'feat(tokens)!' : 'feat(tokens)'}: ${a.title}\n\n${summary}\n\nTier ${tier.tier}. Proposed through Bridge MCP (source: mcp).`;
    const res = await commitToNewLocalBranch(ctx.root!, { base: 'HEAD', branch, message, files, protectedBranches, branchPrefix: config.governance.branchPrefix });
    return {
      status: 'branch-created',
      ...preview,
      branch,
      base,
      commit: res.sha,
      diff: res.diff.length > 12000 ? `${res.diff.slice(0, 12000)}\n... (truncated)` : res.diff,
      next: `Your working tree is untouched. Review with \`git diff ${base}...${branch}\` or bridge_get_review { branch: "${branch}" }; push and open a PR yourself when the design owner agrees.`,
    };
  }
  const gh = (await ctx.github())!;
  if (!ctx.canWriteRemote) return { status: 'preview', message: 'Read-only: set GITHUB_TOKEN to open this as a pull request.', ...preview, fileContents: files };
  const commitMsg = `feat(tokens): ${a.title}\n\nProposed through Bridge MCP (source: mcp). Tier ${tier.tier}.`;
  const base = ctx.ref ?? baseBranchOf(config);
  for (let i = 2; await gh.getBranchSha(branch).then(Boolean, () => false); i++) branch = `${config.governance.branchPrefix}${slugTitle}-${i}`;
  const commit = await gh.commitToNewBranch({ base, branch, message: commitMsg, files });
  const labels = [...config.governance.labels, `tier: ${tier.tier}`, ...(tier.tier === 3 ? ['tokens'] : []), ...(tier.bump === 'major' ? ['breaking'] : [])];
  // Tier 2 and 3 open as drafts until design review (docs/GOVERNANCE.md).
  const pr = await gh.createPullRequest({ base, head: branch, title: `feat(tokens): ${a.title}`, body, draft: tier.tier >= 2 });
  await gh.addLabels(pr.number, labels);
  return { status: 'pr-opened', ...preview, branch, commit: commit.sha, pr: pr.number, url: pr.url, labels, draft: tier.tier >= 2 };
}

// --- reviews --------------------------------------------------------------------------------------------

export async function listReviews(ctx: BridgeContext, a: { state?: 'open' | 'closed' | 'all'; onlyBridge?: boolean }) {
  const { config } = await ctx.config();
  const out: Record<string, unknown> = {};
  if (ctx.mode === 'local' && ctx.isGit) {
    const refs = (await git(ctx.root!, ['for-each-ref', '--format=%(refname:short)|%(committerdate:iso8601)|%(subject)', `refs/heads/${config.governance.branchPrefix}`]))
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [branch, date, subject] = l.split('|');
        return { branch, date, subject };
      });
    out.localBranches = refs;
  }
  const gh = await ctx.github();
  if (gh) {
    try {
      let pulls = await gh.listPullRequests(a.state ?? 'open');
      if (a.onlyBridge) pulls = pulls.filter((p) => p.labels.some((l) => config.governance.labels.includes(l)) || p.headRef.startsWith(config.governance.branchPrefix));
      out.repo = gh.fullName;
      out.pullRequests = pulls.map((p) => ({ number: p.number, title: p.title, state: p.state, draft: p.draft, author: p.author, head: p.headRef, labels: p.labels, bridge: p.labels.some((l) => config.governance.labels.includes(l)), updatedAt: p.updatedAt, url: p.url }));
    } catch (e) {
      out.pullRequestsError = (e as Error).message;
    }
  } else out.pullRequestsError = 'No GitHub repo known: set "repo" in bridge.config.json or add an origin remote.';
  return out;
}

async function setAt(source: RepoSource, config: TokenSet['config']) {
  return core.loadTokenSet(source, config);
}

export async function getReview(ctx: BridgeContext, a: { pr?: number; branch?: string }) {
  const { config } = await ctx.config();
  if (!a.pr && !a.branch) throw new Error('Pass pr (number) or branch (local proposal branch).');
  let baseSrc: RepoSource;
  let headSrc: RepoSource;
  let meta: Record<string, unknown> = {};
  let changedFiles: string[] = [];
  if (a.branch) {
    if (ctx.mode !== 'local' || !ctx.isGit) throw new Error('branch reviews need local mode in a git repo; use pr for GitHub.');
    const baseRef = (await branchExists(ctx.root!, baseBranchOf(config))) ? baseBranchOf(config) : 'HEAD';
    const mb = (await git(ctx.root!, ['merge-base', baseRef, a.branch])).trim();
    baseSrc = new GitRefSource(ctx.root!, mb);
    headSrc = new GitRefSource(ctx.root!, a.branch);
    changedFiles = (await git(ctx.root!, ['diff', '--name-only', mb, a.branch])).split('\n').filter(Boolean);
    const log = (await git(ctx.root!, ['log', '--format=%h %s', `${mb}..${a.branch}`])).trim();
    meta = { branch: a.branch, base: baseRef, mergeBase: mb.slice(0, 10), commits: log.split('\n').filter(Boolean) };
  } else {
    const gh = await ctx.github();
    if (!gh) throw new Error('No GitHub repo known: set "repo" in bridge.config.json.');
    const pr = await gh.getPullRequest(a.pr!);
    const [files, checks, reviews] = await Promise.all([gh.listPullRequestFiles(a.pr!), gh.getChecks(pr.headSha), gh.listReviews(a.pr!)]);
    baseSrc = new GitHubSource(gh, pr.baseRef);
    headSrc = new GitHubSource(gh, pr.headSha);
    changedFiles = files.map((f) => f.filename);
    const latest = new Map<string, string>();
    for (const r of reviews) if (r.state !== 'COMMENTED' && r.user) latest.set(r.user, r.state);
    meta = {
      pr: pr.number,
      title: pr.title,
      url: pr.url,
      author: pr.author,
      state: pr.state,
      draft: pr.draft,
      labels: pr.labels,
      head: pr.headRef,
      base: pr.baseRef,
      ci: checks,
      approvals: [...latest.entries()].filter(([, s]) => s === 'APPROVED').map(([u]) => u),
      changesRequested: [...latest.entries()].filter(([, s]) => s === 'CHANGES_REQUESTED').map(([u]) => u),
    };
  }
  const [before, after] = await Promise.all([setAt(baseSrc, config), setAt(headSrc, config)]);
  const changes = core.diff(before, after);
  const pairs = await core.readContrastPairs(headSrc, config).catch(() => []);
  const delta = pairs.length ? core.contrastDelta(core.runContrast(before, pairs, config.contrast?.modes), core.runContrast(after, pairs, config.contrast?.modes)) : [];
  const prevErrors = new Set(core.validate(before).map(issueKey));
  const errors = core.validate(after).filter((i) => i.level === 'error');
  const tokenRoot = config.tokens.root.replace(/\/$/, '');
  const otherFiles = changedFiles.filter((f) => !f.startsWith(`${tokenRoot}/`) && !f.startsWith(`${config.changesets?.dir ?? '.changeset'}/`));
  const tier = core.classify(changes, otherFiles, config);
  const imp = core.impact(before, after, changes, 20);
  const labelTier = Array.isArray(meta.labels) ? (meta.labels as string[]).map((l) => /^tier:\s*(\d)/i.exec(l)?.[1]).find(Boolean) : undefined;
  return {
    ...meta,
    changedFiles,
    tier: tier.tier,
    bump: tier.bump,
    reasons: tier.reasons,
    ...(labelTier && Number(labelTier) < tier.tier ? { tierWarning: `Labelled tier ${labelTier} but the change is Tier ${tier.tier}.` } : {}),
    tokenChanges: changes.length,
    diffTable: core.tokenTable(changes.map((c) => ({ ...c, file: prefixPath(after, c.file) }))),
    contrastTable: core.contrastTable(delta),
    contrastNewFailures: delta.filter((d) => d.passBefore && !d.passAfter).length,
    validation: { errors: errors.length, newErrors: errors.filter((i) => !prevErrors.has(issueKey(i))) },
    impact: imp,
  };
}

export async function reviewPr(ctx: BridgeContext, a: { pr: number; event: 'comment' | 'approve' | 'request_changes'; body: string }) {
  const gh = await ctx.github();
  if (!gh) throw new Error('No GitHub repo known: set "repo" in bridge.config.json.');
  if (!ctx.canWriteRemote) throw new Error('Reviewing needs GITHUB_TOKEN. Without it Bridge is read-only.');
  if (!a.body.trim()) throw new Error('A review needs a body that says what to fix or why it is fine.');
  const event = ({ comment: 'COMMENT', approve: 'APPROVE', request_changes: 'REQUEST_CHANGES' } as const)[a.event];
  const r = await gh.createReview(a.pr, { event, body: `${a.body.trim()}\n\n_Review drafted with Bridge MCP by an AI agent on behalf of the token owner._` });
  return { pr: a.pr, event, id: r.id, state: r.state, note: event === 'APPROVE' ? 'Approval recorded under your GitHub account. A human still merges.' : undefined };
}

// --- scaffold -------------------------------------------------------------------------------------------

export async function scaffoldComponentOp(ctx: BridgeContext, a: ScaffoldInput & { write?: boolean }) {
  const { config } = await ctx.config();
  const set = await ctx.tokens();
  const res = await scaffoldComponent(ctx.source, config, set, a);
  const write = ctx.mode === 'local' && a.write !== false;
  if (write) {
    for (const f of res.files) {
      const abs = join(ctx.root!, f.path);
      if (await access(abs).then(() => true, () => false)) throw new Error(`${f.path} exists; not overwriting.`);
    }
    for (const f of res.files) {
      await mkdir(dirname(join(ctx.root!, f.path)), { recursive: true });
      await writeFile(join(ctx.root!, f.path), f.content);
    }
  }
  return { written: write, tier: 2, files: write ? res.files.map((f) => f.path) : res.files, nextSteps: res.notes };
}

// --- audit (prompt helper) ------------------------------------------------------------------------------

export async function auditUi(ctx: BridgeContext, code: string) {
  const set = await ctx.tokens();
  return auditSnippet(set, code);
}

// --- visual impact ----------------------------------------------------------------------------------------

/**
 * Visual impact of a change: screenshots of the stories and app screens it touches at both refs, pixel-diffed.
 * Local repos only (it builds Storybook and the app). `plan` returns the selection without building.
 */
export async function visualImpact(
  ctx: BridgeContext,
  a: { base?: string; head?: string; out?: string; only?: ('stories' | 'app')[]; plan?: boolean; threshold?: number; maxStoriesPerComponent?: number },
  run?: typeof import('@bridge-ds/visual').runImpact,
) {
  if (ctx.mode !== 'local' || !ctx.root) throw new Error('Visual impact needs a local checkout (start Bridge with --root): it builds Storybook and the app at both refs.');
  if (!ctx.isGit) throw new Error(`${ctx.root} is not a git repository.`);
  const out = a.out ? resolve(ctx.root, a.out) : join(ctx.root, 'visual-impact');
  // Loaded on demand: the capture stack (playwright-core, pngjs) is not needed by any other tool.
  const runImpact = run ?? (await import('@bridge-ds/visual')).runImpact;
  const r = await runImpact({
    root: ctx.root,
    base: a.base ?? 'main',
    head: a.head ?? 'HEAD',
    out,
    ...(a.only?.length ? { only: a.only } : {}),
    ...(a.plan ? { plan: true } : {}),
    ...(a.threshold !== undefined ? { threshold: a.threshold } : {}),
    ...(a.maxStoriesPerComponent ? { maxStoriesPerComponent: a.maxStoriesPerComponent } : {}),
    log: () => undefined,
  });
  const m = r.manifest;
  const changed = m.shots.filter((s) => s.status !== 'unchanged').sort((x, y) => y.percent - x.percent);
  return {
    summary: r.summary,
    base: m.base,
    head: m.head,
    counts: m.summary,
    selection: {
      tokens: m.selection.tokens.length,
      directTokens: m.selection.tokens.filter((t) => t.kind === 'direct').map((t) => t.path),
      components: m.selection.components.map((c) => ({ id: c.id, why: c.reasons[0] })),
      stories: m.selection.stories.length,
      fallback: m.selection.fallback,
      app: m.selection.app,
    },
    changed: changed.slice(0, 25).map((s) => ({
      label: s.label,
      mode: `${s.tenant ? `${s.tenant}/` : ''}${s.brand}/${s.theme}`,
      status: s.status,
      percent: s.percent,
      boxes: s.boxes.length,
      ...(s.images.composite ? { composite: join(r.outDir, s.images.composite) } : {}),
      ...(s.error ? { error: s.error } : {}),
    })),
    outDir: r.outDir,
    manifest: r.manifestPath,
    next: a.plan
      ? 'Plan only. Run again without plan to build both refs and capture (takes minutes, needs Chrome).'
      : changed.length
        ? 'Open the composite images (before | after | diff) to review; manifest.json has every shot with bounding boxes.'
        : 'No visual change in the captured stories and screens.',
  };
}

// --- adoption audit -------------------------------------------------------------------------------------

/** The design system the audit measures against: tokens of this repo, its components and package names. */
async function designSystemIndex(ctx: BridgeContext): Promise<DesignSystemIndex> {
  const { config } = await ctx.config();
  const set = await ctx.tokens();
  const components = (await listComponentNames(ctx.source, config)).map((c) => c.name).filter((n) => /^[A-Z]/.test(n));
  let packages = config.audit?.packages;
  if (!packages) {
    packages = ['@bridge-ds/react'];
    const parts = (config.components?.dir ?? '').split('/').filter(Boolean);
    for (let i = parts.length; i > 0; i--) {
      const text = await ctx.source.read(`${parts.slice(0, i).join('/')}/package.json`);
      if (!text) continue;
      const name = (JSON.parse(text) as { name?: string }).name;
      if (name && !packages.includes(name)) packages.unshift(name);
      break;
    }
  }
  return new DesignSystemIndex(set, {
    packages,
    components,
    ...(config.audit?.foreignLibraries ? { foreignLibraries: config.audit.foreignLibraries } : {}),
    ...(config.audit?.nativeElements ? { nativeElements: config.audit.nativeElements } : {}),
  });
}

/** Audit a product folder or file (local only): adoption metrics, top files, top fixes, and findings for one file. */
export async function auditOp(ctx: BridgeContext, a: { path: string; baseline?: string; label?: string; limit?: number; findings?: boolean }) {
  if (ctx.mode !== 'local' || !ctx.root) throw new Error('bridge_audit reads product code from disk: start the server on a local design system repo (--root).');
  const { config } = await ctx.config();
  const target = isAbsolute(a.path) ? a.path : resolve(ctx.root, a.path);
  if (!existsSync(target)) throw new Error(`No such file or folder: ${target}`);
  const ds = await designSystemIndex(ctx);
  const { files, skipped } = collectAuditFiles(target, config.audit?.exclude ?? []);
  let report = buildAuditReport({ files, skipped, target: a.path, ...(a.label ? { label: a.label } : {}) }, ds);
  if (a.baseline) report = compareWithBaseline(report, JSON.parse(readFileSync(isAbsolute(a.baseline) ? a.baseline : resolve(ctx.root, a.baseline), 'utf8')) as AuditReport);
  const limit = a.limit ?? 10;
  const single = files.length === 1;
  const withFindings = a.findings ?? single;
  return {
    target: a.path,
    files: report.target.files,
    metrics: report.metrics,
    ...(report.baseline ? { sinceBaseline: { tokenAdoption: report.baseline.tokenAdoption, componentAdoption: report.baseline.componentAdoption, hardcoded: report.baseline.hardcoded, improved: report.baseline.improved.length, regressed: report.baseline.regressed.slice(0, limit) } } : {}),
    byCategory: report.byCategory,
    components: {
      ds: report.components.ds,
      foreign: Object.fromEntries(Object.entries(report.components.foreign).map(([lib, x]) => [lib, { instances: x.instances, top: Object.entries(x.components).sort((p, q) => q[1] - p[1]).slice(0, 8).map(([n, k]) => `${n} ${k}`) }])),
      native: report.components.native,
      recreated: report.components.recreated,
    },
    topFiles: report.topFiles.slice(0, limit),
    topFixes: report.topFixes.slice(0, limit).map((f) => ({ value: f.value, category: f.category, count: f.count, ...(f.suggestion ? { use: `var(${f.suggestion.cssVar})`, token: f.suggestion.token, tokenValue: f.suggestion.value, ...(f.suggestion.mode ? { mode: f.suggestion.mode } : {}), confidence: f.suggestion.level } : { use: null }) })),
    ...(withFindings
      ? {
          findings: report.files
            .filter((f) => f.findings.length || f.components.length)
            .slice(0, single ? 1 : limit)
            .map((f) => ({
              file: f.path,
              values: f.findings.map((x) => ({ line: x.line, value: x.value, category: x.category, ...(x.property ? { property: x.property } : {}), ...(x.suggestion ? { use: `var(${x.suggestion.cssVar})`, confidence: x.suggestion.level } : {}) })),
              components: f.components.map((c) => ({ line: c.line, name: c.name, kind: c.kind, library: c.library, ...(c.suggestion ? { use: c.suggestion } : {}) })),
            })),
        }
      : {}),
    next: single
      ? 'Rewrite the file with the DS components and tokens listed (bridge_get_component for props). Keep behavior; when no token fits, say which one is missing.'
      : 'Start with the top files; the migrate-file-to-ds prompt rewrites one file. `bridge audit <path> --fix` replaces exact CSS matches; `--json` writes the full report.',
  };
}
