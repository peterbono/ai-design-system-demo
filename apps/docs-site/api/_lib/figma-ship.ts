// The Figma push rules of @bridge-ds/core (build-requests.ts: isFigmaPush, figmaPushScope, tokenFileChanges,
// figmaShipReviewBody), for api/ship. The /api functions run as plain Node modules and load no workspace package at
// runtime, so the few lines the server needs live here; src/lib/figma-ship-parity.test.ts runs both on the same
// fixtures and fails the moment they disagree. docs/BUILD-REQUESTS.md has the rule.

export const SOURCE_FIGMA_LABEL = 'source: figma';
export const FROM_FIGMA_LABEL = 'from-figma';
export const EXPLORATION_LABEL = 'exploration';
export const FIGMA_SHIP_HEADING = '**Bridge: shipped from Figma**';

const CONFIG_FILE = 'bridge.config.json';
const DEFAULT_GUARDRAILS = ['AGENTS.md', 'CLAUDE.md', 'docs/GOVERNANCE.md', '.stylelintrc.json', '.github/', CONFIG_FILE];
const ORIGIN = /<!-- bridge-from-figma (\{[\s\S]*?\}) -->/;
const VALUE_SIDE = [/^\.changeset\//, /^\.bridge\//, /\.md$/, /^docs\//];

export type FigmaPushScope = 'token-values' | 'token-structure' | 'token-unknown' | 'component' | 'outside';
export interface TokenChange {
  kind: 'added' | 'changed' | 'removed';
  path: string;
  descriptionOnly?: boolean;
}

/** What the rules read from bridge.config.json: the tokens root, the guardrail files and the contrast checks file. */
export interface ShipConfig {
  tokensRoot: string;
  guardrails: string[];
  contrast: string;
}

const trim = (p: string) => p.replace(/^\/+|\/+$/g, '');

/** The parts of bridge.config.json the rules need, with core's defaults (config.ts defineConfig). */
export function shipConfig(raw: unknown): ShipConfig {
  const c = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const root = typeof c.tokens?.root === 'string' ? trim(c.tokens.root) || '.' : 'tokens';
  const contrastPath = typeof c.contrast?.path === 'string' ? trim(c.contrast.path) : [root === '.' ? '' : root, 'contrast.checks.json'].filter(Boolean).join('/');
  const g = c.governance?.guardrails;
  const guardrails = Array.isArray(g) && g.every((x: unknown) => typeof x === 'string') ? (g as string[]) : [...DEFAULT_GUARDRAILS, contrastPath];
  return { tokensRoot: root, guardrails, contrast: contrastPath };
}

/** core risk.ts isGuardrail. */
export function isGuardrail(path: string, cfg: ShipConfig): boolean {
  const list = [...cfg.guardrails, CONFIG_FILE, cfg.contrast];
  return list.some((g) => (g.endsWith('/') ? path.startsWith(g) : path === g)) || path.startsWith('.github/') || path.endsWith('/contrast.checks.json') || path === 'contrast.checks.json';
}

/** A token file of the pull request: *.tokens.json, or a .json under the tokens root that is not a guardrail. */
export function isTokenFile(path: string, cfg: ShipConfig): boolean {
  const p = path.replace(/^\/+/, '');
  if (isGuardrail(p, cfg)) return false;
  return p.endsWith('.tokens.json') || (cfg.tokensRoot !== '.' && p.startsWith(`${cfg.tokensRoot}/`) && p.endsWith('.json'));
}

const labelNames = (labels: readonly ({ name?: string } | string)[] | null | undefined) => (labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? '')).toLowerCase());

function hasOrigin(body: string | null | undefined): boolean {
  const m = ORIGIN.exec(body ?? '');
  if (!m) return false;
  try {
    const o = JSON.parse(m[1]!);
    return typeof o.component === 'string' && (o.route === 'token-change' || o.route === 'claude-draft');
  } catch {
    return false;
  }
}

/** core isFigmaPush. */
export function isFigmaPush(p: { labels?: readonly ({ name?: string } | string)[] | null; body?: string | null }): boolean {
  const l = labelNames(p.labels);
  return l.includes(SOURCE_FIGMA_LABEL) || l.includes(FROM_FIGMA_LABEL) || hasOrigin(p.body);
}

export const isExploration = (labels: readonly ({ name?: string } | string)[] | null | undefined) => labelNames(labels).includes(EXPLORATION_LABEL);

/** core figmaPushScope. */
export function figmaPushScope(files: readonly { path: string }[], tokenChanges: readonly { kind: string }[] | null, cfg: ShipConfig): FigmaPushScope {
  const tokenDir = cfg.tokensRoot !== '.' ? cfg.tokensRoot : undefined;
  let code = false;
  let tokenFiles = false;
  for (const f of files) {
    const p = f.path.replace(/^\/+/, '');
    const isToken = p.endsWith('.tokens.json') || (tokenDir ? p.startsWith(`${tokenDir}/`) && p.endsWith('.json') : false);
    if (isGuardrail(p, cfg)) return 'outside';
    if (isToken) tokenFiles = true;
    else if (!VALUE_SIDE.some((r) => r.test(p))) code = true;
  }
  if (code) return 'component';
  if (tokenChanges?.some((c) => c.kind === 'renamed' || c.kind === 'removed')) return 'token-structure';
  if (tokenFiles && !tokenChanges) return 'token-unknown';
  return 'token-values';
}

/** core tokenFileChanges. Throws on unreadable JSON. */
export function tokenFileChanges(files: readonly { before: string | null | undefined; after: string | null | undefined }[]): TokenChange[] {
  const flat = (text: string | null | undefined) => {
    const out = new Map<string, Record<string, unknown>>();
    if (!text) return out;
    const walk = (node: unknown, path: string[]) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const o = node as Record<string, unknown>;
      if ('$value' in o) {
        out.set(path.join('.'), o);
        return;
      }
      for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) walk(v, [...path, k]);
    };
    walk(JSON.parse(text), []);
    return out;
  };
  const changes: TokenChange[] = [];
  for (const f of files) {
    const before = flat(f.before);
    const after = flat(f.after);
    for (const [path, b] of before) {
      const a = after.get(path);
      if (!a) {
        changes.push({ kind: 'removed', path });
        continue;
      }
      const { $description: bd, ...bRest } = b;
      const { $description: ad, ...aRest } = a;
      if (JSON.stringify(bRest) !== JSON.stringify(aRest)) changes.push({ kind: 'changed', path });
      else if (bd !== ad) changes.push({ kind: 'changed', path, descriptionOnly: true });
    }
    for (const path of after.keys()) if (!before.has(path)) changes.push({ kind: 'added', path });
  }
  return changes;
}

/** core figmaShipReviewBody. */
export function figmaShipReviewBody(by?: string | null): string {
  const who = by ? ` by ${by.startsWith('@') || by.includes(' ') ? by : `@${by}`}` : '';
  return `${FIGMA_SHIP_HEADING}\n\nPushed from Figma${who}: token values only, so it ships once the automatic checks pass (docs/BUILD-REQUESTS.md). Undo it from History in Bridge Studio.`;
}
