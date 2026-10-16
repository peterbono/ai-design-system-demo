// bridge.config.json for the MCP server and the CLI: the schema, parser and normalized shape are
// @bridge-ds/core's (packages/core/bridge.config.schema.json). This file only adds detection, for repos
// that have no bridge.config.json yet (`bridge init` writes what it detects).
import { type BridgeConfig, type BridgeConfigInput, CONFIG_FILE, loadConfig, toConfigJson } from '@bridge-ds/core';

export { CONFIG_FILE, loadConfig as parseConfig, toConfigJson, type BridgeConfig };

/** Where `bridge init` points "$schema" in a detected config. */
export const SCHEMA_URL = 'https://raw.githubusercontent.com/peterbono/ai-design-system-demo/main/packages/core/bridge.config.schema.json';

// --- Detection (bridge init, and remote repos with no config) --------------------------------------------

const TIER_NAMES: Record<string, RegExp> = {
  primitive: /^(primitives?|core|base|global|foundation|foundations|ref|reference)$/i,
  brand: /^(brands?|themes?-brand)$/i,
  semantic: /^(semantic|semantics|system|sys|alias|aliases|themes?)$/i,
  density: /^(density|densities|scale|scales)$/i,
  component: /^(components?|comp|cmp)$/i,
};
const THEME_WORDS = ['light', 'dark', 'high-contrast', 'hc'];
const DENSITY_WORDS = ['comfortable', 'compact', 'spacious', 'cozy'];

const isTokenJson = (text: string) => /"\$value"\s*:/.test(text);

/**
 * Builds a config from a file list. `read` returns file contents (to tell token JSON from other JSON).
 * Heuristic: finds the directory that holds the token files, maps sub-directories to tiers by name,
 * and turns light/dark (and density) file names into modes.
 */
export async function detectConfig(files: string[], read: (p: string) => Promise<string | null>, extra: { repo?: string; branch?: string } = {}): Promise<BridgeConfig> {
  const skip = /(^|\/)(node_modules|dist|build|\.git|coverage|storybook-static|test|tests|__tests__|fixtures|examples?)\//;
  const jsonFiles = files.filter((f) => f.endsWith('.json') && !skip.test(f) && !/package(-lock)?\.json$|tsconfig|\.docs\.json$/.test(f));
  const tokenFiles: string[] = [];
  for (const f of jsonFiles.slice(0, 400)) {
    const t = await read(f);
    if (t && isTokenJson(t)) tokenFiles.push(f);
  }
  if (!tokenFiles.length) throw new Error('No DTCG token files found (JSON files with "$value"). Write bridge.config.json by hand.');
  // Deepest common directory.
  const parts = tokenFiles.map((f) => f.split('/').slice(0, -1));
  let common = parts[0]!;
  for (const p of parts) {
    let k = 0;
    while (k < common.length && common[k] === p[k]) k++;
    common = common.slice(0, k);
  }
  const root = common.join('/') || '.';
  const rel = (f: string) => (root === '.' ? f : f.slice(root.length + 1));
  const relFiles = tokenFiles.map(rel);
  const allTokens = relFiles.every((f) => f.endsWith('.tokens.json'));
  const include = [allTokens ? '**/*.tokens.json' : '**/*.json'];

  const tiers: Record<string, string[]> = {};
  const topDirs = [...new Set(relFiles.filter((f) => f.includes('/')).map((f) => f.split('/')[0]!))];
  for (const d of topDirs) {
    const tier = Object.entries(TIER_NAMES).find(([, re]) => re.test(d))?.[0] ?? d;
    (tiers[tier] ??= []).push(d);
  }

  const base = (f: string) => f.split('/').pop()!.replace(/(\.tokens)?\.json$/, '');
  const modes: Record<string, { values: string[]; default: string; parity: boolean }> = {};
  const themeVals = THEME_WORDS.filter((w) => relFiles.some((f) => base(f) === w));
  if (themeVals.length >= 2) modes.theme = { values: themeVals, default: themeVals.includes('light') ? 'light' : themeVals[0]!, parity: true };
  const densVals = DENSITY_WORDS.filter((w) => relFiles.some((f) => base(f) === w));
  if (densVals.length >= 2) modes.density = { values: densVals, default: densVals[0]!, parity: false };
  // Brands: files in a brand-tier dir named `<brand>.tokens.json` with no dot in the brand name.
  const brandDirs = tiers.brand ?? [];
  const brandVals = relFiles.filter((f) => brandDirs.some((d) => f.startsWith(`${d}/`)) && !base(f).includes('.')).map(base);
  if (brandVals.length >= 2) modes.brand = { values: brandVals, default: brandVals[0]!, parity: false };

  // Layers: tiers in canonical order, mode files replaced by placeholders.
  const ext = allTokens ? '.tokens.json' : '.json';
  const dirOf = (f: string) => (f.includes('/') ? f.split('/').slice(0, -1).join('/') : '');
  const modeFile = (f: string): string | null => {
    const dir = dirOf(f) ? `${dirOf(f)}/` : '';
    const b = base(f);
    for (const [name, m] of Object.entries(modes)) if (m.values.includes(b)) return `${dir}{${name}}${ext}`;
    const [first, second, extra] = b.split('.');
    if (!extra && second && modes.brand?.values.includes(first!) && modes.theme?.values.includes(second)) return `${dir}{brand}.{theme}${ext}`;
    return null;
  };
  const order = ['primitive', 'brand', 'semantic', 'density', 'component'];
  // A file's tier: its top directory, or its own name for loose files (core.json -> primitive).
  const tierOf = (f: string) => Object.entries(tiers).find(([, ds]) => ds.some((d) => f.startsWith(`${d}/`)))?.[0] ?? Object.entries(TIER_NAMES).find(([, re]) => re.test(base(f)))?.[0];
  const tierIdx = (f: string) => {
    const i = order.indexOf(tierOf(f) ?? '');
    return i < 0 ? 2 : i;
  };
  const patterns = new Map<string, { files: string; key: number }>();
  for (const f of relFiles) {
    const mf = modeFile(f);
    const dir = dirOf(f);
    // Plain files of a directory with no mode files collapse into one glob.
    const dirHasModes = relFiles.some((x) => dirOf(x) === dir && modeFile(x));
    const pattern = mf ?? (dir && !dirHasModes && relFiles.filter((x) => dirOf(x) === dir).length > 0 ? `${dir}/*${ext}` : f);
    const placeholders = (pattern.match(/\{/g) ?? []).length;
    // Within a tier: mode-independent first, then mode files; multi-mode overrides after their tier.
    const key = tierIdx(f) + (placeholders === 0 ? 0 : placeholders === 1 ? 0.2 : 0.6);
    if (!patterns.has(pattern)) patterns.set(pattern, { files: pattern, key });
  }
  // An override keyed by several modes (brands/{brand}.{theme}) goes right after the layers of those modes.
  for (const p of patterns.values()) {
    const phs = p.files.match(/\{[^}]+\}/g) ?? [];
    if (phs.length < 2) continue;
    const keys = [...patterns.values()].filter((q) => (q.files.match(/\{[^}]+\}/g) ?? []).length === 1 && phs.some((ph) => q.files.includes(ph))).map((q) => q.key);
    if (keys.length) p.key = Math.max(...keys) + 0.1;
  }
  const collapsed = [...patterns.values()].sort((x, y) => x.key - y.key).map((p) => ({ files: p.files, optional: (p.files.match(/\{/g) ?? []).length > 1 }));
  for (const f of relFiles) {
    const t = tierOf(f);
    if (t && !f.includes('/') && !tiers[t]) tiers[t] = [f];
  }

  const contrast = files.find((f) => /contrast[^/]*\.json$/i.test(f) && !skip.test(f));
  const docsFiles = files.filter((f) => f.endsWith('.docs.json') && !skip.test(f));
  let components: BridgeConfigInput['components'];
  if (docsFiles.length) {
    const dirs = docsFiles.map((f) => f.split('/').slice(0, -2).join('/'));
    const dir = dirs.sort((a, b) => dirs.filter((x) => x === b).length - dirs.filter((x) => x === a).length)[0]!;
    const styleSuffix = files.some((f) => f.startsWith(`${dir}/`) && f.endsWith('.module.css')) ? '.module.css' : '.css';
    components = { dir, docsSuffix: '.docs.json', styleSuffix, reference: files.some((f) => f === `${dir}/Button/Button.docs.json`) ? 'Button' : docsFiles[0]!.split('/').slice(-2, -1)[0] };
  }
  const findDoc = (re: RegExp) => files.find((f) => re.test(f) && !skip.test(f));
  const designLanguage = findDoc(/(^|\/)(DESIGN-LANGUAGE|design-language|DESIGN)\.md$/);
  const guidelines = findDoc(/^AGENTS\.md$/) ?? findDoc(/^CLAUDE\.md$/);
  const governance = findDoc(/(^|\/)GOVERNANCE\.md$/);

  return loadConfig({
    $schema: SCHEMA_URL,
    version: 1,
    ...(extra.repo ? { repo: extra.repo } : {}),
    branch: extra.branch ?? 'main',
    tokens: { root, include, tiers, layers: collapsed },
    modes,
    ...(contrast ? { contrast: { path: contrast } } : {}),
    ...(components ? { components } : {}),
    docs: { ...(designLanguage ? { designLanguage } : {}), ...(guidelines ? { guidelines } : {}), ...(governance ? { governance } : {}) },
    governance: {
      protectedBranches: ['main', 'master'],
      branchPrefix: 'bridge/',
      labels: ['source: mcp'],
      guardrails: [guidelines, 'CLAUDE.md', '.github/', governance, contrast, CONFIG_FILE].filter(Boolean) as string[],
      owners: { design: [], tech: [] },
    },
  });
}
