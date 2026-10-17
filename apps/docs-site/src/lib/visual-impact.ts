// Visual impact in Reviews: where the manifest of a pull request lives, and the views on it (state, filters).
// The manifest is written by `bridge impact` (@bridge-ds/visual) and published by .github/workflows/visual-impact.yml
// to the bridge-visual branch under pr-<number>/<head sha>/. Only the fields used here are typed.

export interface VisualShot {
  key: string;
  kind: 'story' | 'route';
  label: string;
  tenant?: string;
  brand: string;
  theme: string;
  status: 'changed' | 'unchanged' | 'added' | 'removed' | 'error';
  percent: number;
  boxes: { x: number; y: number; width: number; height: number }[];
  size: { before: { width: number; height: number } | null; after: { width: number; height: number } | null };
  images: { before?: string; after?: string; diff?: string; composite?: string };
  error?: string;
}

export interface VisualManifest {
  version: number;
  createdAt: string;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  options: { threshold: number };
  selection: { tokens: { path: string; kind: string }[]; components: { id: string }[]; fallback: string | null };
  summary: { shots: number; changed: number; unchanged: number; added: number; removed: number; errors: number; maxPercent: number };
  shots: VisualShot[];
}

export const VISUAL_BRANCH = 'bridge-visual';

/** Paths whose changes the visual impact workflow reacts to (same list as its `paths` filter). */
export const VISUAL_PATHS = [/^packages\/tokens\/src\//, /^packages\/react\/src\//, /^apps\/admin\/src\//, /^\.storybook\//];
export const touchesVisuals = (files: string[]) => files.some((f) => VISUAL_PATHS.some((r) => r.test(f)));

export function visualBase(owner: string, repo: string, pr: number, sha: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${VISUAL_BRANCH}/pr-${pr}/${sha}`;
}

/**
 * What the "not run yet" state offers. `auto`: the workflow runs on its own, link to it. On demand
 * (bridge.config.json visualImpact.mode): `asked` once the pull request carries the visual-check label, else `ask`
 * (a button that adds the label) with a token that can write, or `ask-on-github` without one.
 */
export type VisualAsk = 'auto' | 'asked' | 'ask' | 'ask-on-github';

export function visualAsk(input: { mode: 'auto' | 'on-demand' | undefined; labels: (string | { name?: string })[] | null; canWrite: boolean; label?: string }): VisualAsk {
  if (input.mode !== 'on-demand') return 'auto';
  const label = input.label ?? 'visual-check';
  if ((input.labels ?? []).some((l) => (typeof l === 'string' ? l : l.name) === label)) return 'asked';
  return input.canWrite ? 'ask' : 'ask-on-github';
}

export type VisualState = { kind: 'not-computed' } | { kind: 'no-change'; manifest: VisualManifest } | { kind: 'changes'; manifest: VisualManifest; shots: VisualShot[] };

const RANK: Record<VisualShot['status'], number> = { changed: 0, added: 1, removed: 2, error: 3, unchanged: 4 };

export function visualState(manifest: VisualManifest | null): VisualState {
  if (!manifest || !Array.isArray(manifest.shots)) return { kind: 'not-computed' };
  const shots = manifest.shots.filter((s) => s.status !== 'unchanged').sort((a, b) => RANK[a.status] - RANK[b.status] || b.percent - a.percent);
  return shots.length ? { kind: 'changes', manifest, shots } : { kind: 'no-change', manifest };
}

export interface VisualFilter {
  brand: string;
  theme: string;
  kind: 'all' | 'story' | 'route';
}

export function filterShots(shots: VisualShot[], f: VisualFilter): VisualShot[] {
  return shots.filter((s) => (f.brand === 'all' || s.brand === f.brand) && (f.theme === 'all' || s.theme === f.theme) && (f.kind === 'all' || s.kind === f.kind));
}

/** Distinct values of a field, in first-seen order: the filter options. */
export function facet(shots: VisualShot[], key: 'brand' | 'theme'): string[] {
  return [...new Set(shots.map((s) => s[key]))];
}

export function modeLabel(s: VisualShot): string {
  const tenant = s.tenant ? `${s.tenant[0]!.toUpperCase()}${s.tenant.slice(1)}, ` : '';
  return `${tenant}${s.brand}, ${s.theme}`;
}

export function changeLabel(s: VisualShot): string {
  if (s.status === 'changed') return `${s.percent < 0.01 ? '<0.01' : s.percent.toFixed(2)}% changed`;
  if (s.status === 'added') return 'New';
  if (s.status === 'removed') return 'Gone';
  if (s.status === 'error') return 'Failed';
  return 'No change';
}
