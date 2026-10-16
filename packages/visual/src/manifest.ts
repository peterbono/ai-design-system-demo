// The manifest (manifest.json next to the images) and the views on it: a summary for the CLI and the MCP tool,
// and the sticky pull request comment the GitHub workflow posts.
import type { Manifest, ShotResult, Summary } from './types.js';

export const COMMENT_MARKER = '<!-- bridge-visual-impact -->';

export function summarize(shots: ShotResult[]): Summary {
  const count = (s: ShotResult['status']) => shots.filter((x) => x.status === s).length;
  return {
    shots: shots.length,
    changed: count('changed'),
    unchanged: count('unchanged'),
    added: count('added'),
    removed: count('removed'),
    errors: count('error'),
    maxPercent: shots.reduce((m, s) => Math.max(m, s.percent), 0),
  };
}

/** Changed first (largest change first), then added, removed, errors, unchanged; stable within a group. */
export function rankShots(shots: ShotResult[]): ShotResult[] {
  const rank: Record<ShotResult['status'], number> = { changed: 0, added: 1, removed: 2, error: 3, unchanged: 4 };
  return shots
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank[a.s.status] - rank[b.s.status] || b.s.percent - a.s.percent || a.i - b.i)
    .map((x) => x.s);
}

export const hasVisualChange = (m: Pick<Manifest, 'summary'>) => m.summary.changed + m.summary.added + m.summary.removed > 0;

const mode = (s: ShotResult) => `${s.tenant ? `${s.tenant}, ` : ''}${s.brand}, ${s.theme}`;
/** Compact mode for grouped rows: "bridge light", or "harbor dark" for app screens (the tenant implies the brand). */
const modeShort = (s: ShotResult) => `${s.tenant ?? s.brand} ${s.theme}`;
const pct = (s: ShotResult) => (s.status === 'changed' ? `${s.percent.toFixed(2)}%` : s.status === 'unchanged' ? '0%' : s.status);
const short = (sha: string) => sha.slice(0, 7);
const cell = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** One-paragraph plain-text summary (CLI output, MCP tool result). */
export function summaryLine(m: Manifest): string {
  const s = m.summary;
  if (m.options.plan) {
    const p = m.options.planned ?? { modes: 0, appScreens: 0 };
    return `Plan: ${m.selection.stories.length} stories in ${p.modes} modes and ${p.appScreens} app screens would be captured between ${m.base.ref} (${short(m.base.sha)}) and ${m.head.ref} (${short(m.head.sha)}).`;
  }
  if (!s.shots) return `Nothing to capture: ${m.selection.app.reason.toLowerCase()} and no story is impacted.`;
  const parts = [`${s.changed} of ${s.shots} screenshot${s.shots > 1 ? 's' : ''} changed`];
  if (s.added) parts.push(`${s.added} new`);
  if (s.removed) parts.push(`${s.removed} gone`);
  if (s.errors) parts.push(`${s.errors} failed`);
  return `${parts.join(', ')} between ${m.base.ref} (${short(m.base.sha)}) and ${m.head.ref} (${short(m.head.sha)}).${s.changed ? ` Largest change ${s.maxPercent.toFixed(2)}%.` : ''}`;
}

interface Group {
  label: string;
  shots: ShotResult[];
}

/** Shots grouped by label, in the order of their first (largest) shot. */
export function groupByLabel(shots: ShotResult[]): Group[] {
  const out = new Map<string, Group>();
  for (const s of shots) (out.get(s.label) ?? out.set(s.label, { label: s.label, shots: [] }).get(s.label)!).shots.push(s);
  return [...out.values()];
}

/**
 * Images for the comment: variety first. App screens (up to 2) and then one image per story, largest change
 * first, before a second mode of the same story.
 */
export function pickImages(shots: ShotResult[], max: number): ShotResult[] {
  const out: ShotResult[] = [];
  const seen = new Set<string>();
  const take = (s: ShotResult) => {
    if (out.length < max && !out.includes(s)) out.push(s);
  };
  for (const s of shots.filter((x) => x.kind === 'route')) {
    if (out.length >= 2) break;
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    take(s);
  }
  for (const s of shots) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    take(s);
  }
  for (const s of shots) take(s);
  return out;
}

export interface CommentOptions {
  /** Base URL the manifest's relative image paths resolve against (raw.githubusercontent.com/.../pr-1/sha). */
  imageBase?: string;
  /** Link to the workflow run artifact with every image. */
  artifactUrl?: string;
  /** Composite images shown inline. */
  maxImages?: number;
  maxRows?: number;
}

/** The sticky PR comment: summary table plus before/after/diff composites of the largest changes. */
export function renderComment(m: Manifest, o: CommentOptions = {}): string {
  const maxImages = o.maxImages ?? 6;
  const maxRows = o.maxRows ?? 40;
  const ranked = rankShots(m.shots);
  const changed = ranked.filter((s) => s.status !== 'unchanged');
  const unchanged = ranked.filter((s) => s.status === 'unchanged');
  const lines = [COMMENT_MARKER, '## Visual impact', ''];
  lines.push(`${hasVisualChange(m) ? '**' : ''}${summaryLine(m)}${hasVisualChange(m) ? '**' : ''}`);
  lines.push('');
  const why: string[] = [];
  if (m.selection.tokens.length) {
    const direct = m.selection.tokens.filter((t) => t.kind === 'direct').map((t) => `\`${t.path}\``);
    why.push(`${m.selection.tokens.length} token value${m.selection.tokens.length > 1 ? 's' : ''} change${direct.length ? ` (edited: ${direct.slice(0, 5).join(', ')}${direct.length > 5 ? ', ...' : ''})` : ''}`);
  }
  if (m.selection.components.length) why.push(`components in scope: ${m.selection.components.map((c) => c.id).join(', ')}`);
  if (m.selection.fallback) why.push(m.selection.fallback);
  if (why.length) lines.push(`Why these screens: ${why.join('; ')}.`, '');
  if (changed.length) {
    // One row per story or screen, with the modes where it changed: four modes of one story stay one row.
    const groups = groupByLabel(changed);
    lines.push('| Story or screen | Changed in | Largest |', '| --- | --- | ---: |');
    for (const g of groups.slice(0, maxRows)) {
      const modes = g.shots.map((s) => `${modeShort(s)}${s.status === 'changed' ? '' : ` (${s.status})`}`).join(', ');
      const err = g.shots.find((s) => s.error)?.error;
      lines.push(`| ${cell(g.label)} | ${cell(modes)} | ${pct(g.shots[0]!)}${err ? ` (${cell(err.slice(0, 80))})` : ''} |`);
    }
    if (groups.length > maxRows) lines.push(`| ${groups.length - maxRows} more | | |`);
    lines.push('');
  }
  if (unchanged.length) {
    const groups = groupByLabel(unchanged);
    lines.push(`<details><summary>${unchanged.length} unchanged (${groups.length} ${groups.length === 1 ? 'story or screen' : 'stories and screens'})</summary>`, '', '| Story or screen | Modes |', '| --- | --- |');
    for (const g of groups.slice(0, maxRows)) lines.push(`| ${cell(g.label)} | ${cell(g.shots.map(modeShort).join(', '))} |`);
    if (groups.length > maxRows) lines.push(`| ${groups.length - maxRows} more | |`);
    lines.push('', '</details>', '');
  }
  const picked = pickImages(changed.filter((s) => s.images.composite), maxImages);
  if (picked.length && o.imageBase) {
    lines.push('### Before, after, diff', '');
    const base = o.imageBase.replace(/\/$/, '');
    for (const [i, s] of picked.entries()) {
      lines.push(`<details${i < 2 ? ' open' : ''}><summary>${s.label}, ${mode(s)}: ${pct(s)}</summary>`, '', `![${s.label}, ${mode(s)}](${base}/${s.images.composite})`, '', '</details>', '');
    }
    const rest = changed.filter((s) => s.images.composite).length - picked.length;
    if (rest > 0) lines.push(`${rest} more before/after/diff image${rest > 1 ? 's' : ''}: open this pull request in Bridge Reviews (slider, diff toggle, brand and theme filters) or the workflow artifact.`, '');
  }
  const links = [o.artifactUrl ? `[All images (workflow artifact)](${o.artifactUrl})` : '', o.imageBase ? `[manifest.json](${o.imageBase.replace(/\/$/, '')}/manifest.json)` : ''].filter(Boolean);
  lines.push(`<sub>Bridge visual impact, threshold ${m.options.threshold}, ${Math.round(m.durationMs / 1000)} s. Diffs never fail the check; reviewers decide.${links.length ? ` ${links.join(' · ')}` : ''}</sub>`);
  return `${lines.join('\n')}\n`;
}
