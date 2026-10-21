// Repo snapshot: the files the repo model reads, written by `bridge snapshot` in a team's CI and published to the
// `bridge-data` branch (.github/workflows/bridge-data.yml), plus what only Node can compute (adoption audits run on
// product code) and a compact Figma coverage list. Hosted Studio and Library read it from the raw host with no API
// quota: snapshotSource() serves it as a RepoSource, so loadRepoModel() gives the same model as a live read.
// Pure: no Node, no DOM.

import type { AuditMetrics, AuditReport } from './audit/types';
import type { ContrastPairResult } from './contrast-model';
import type { SpecCoverage } from './component-spec';
import { isUnder, normalizeRepoPath, type RepoSource } from './repo-source';
import type { RepoModel } from './repo-model';

export const SNAPSHOT_SCHEMA_VERSION = 1;
/** Branch the bridge-data workflow publishes to, and the files on it. */
export const SNAPSHOT_BRANCH = 'bridge-data';
export const SNAPSHOT_FILE = 'snapshot.json';
export const SNAPSHOT_AUDITS_DIR = 'audits';
/** Above this, a snapshot is refused (a published file the browser downloads whole). */
export const SNAPSHOT_MAX_BYTES = 5_000_000;

/** One adoption audit: the summary lives in snapshot.json, the full report in audits/<id>.json next to it. */
export interface SnapshotAudit {
  id: string;
  /** Path of the full report on the bridge-data branch ("audits/admin.json"). */
  path: string;
  label?: string;
  generatedAt: string;
  target: { path: string; files: number };
  metrics: AuditMetrics;
}

/** A contrast pair as computed when the snapshot was written, without the token rows (the model has them). */
export type SnapshotContrastPair = Omit<ContrastPairResult, 'fgToken' | 'bgToken'>;

/** Counts for a header or a card, readable without loading the model. */
export interface SnapshotSummary {
  tokens: number;
  /** Null when the component scan was skipped. */
  components: number | null;
  contrast: { pairs: number; checks: number; failing: number };
  /** Components in Figma (generated or drafted) out of the visual ones, null without a specs file. */
  figma: { inFigma: number; visual: number } | null;
}

export interface RepoSnapshot {
  kind: 'bridge-snapshot';
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  tool: { name: 'bridge'; version: string };
  generatedAt: string;
  repo: { owner: string; name: string; branch: string };
  /** Commit the snapshot was computed from. Fresh when it equals the default branch head. */
  sourceSha: string;
  /** Commit date of sourceSha (ISO), when known. */
  committedAt?: string;
  /** Every path the model listed (token root, components dir), so list() answers as the repository did. */
  paths: string[];
  /** Bodies of the files the model read, keyed by repo-relative path. */
  files: Record<string, string>;
  /**
   * Figma coverage of component-specs.json without the specs themselves (the file is over 1 MB here, too big for
   * the GitHub contents source). Null when the repository has no specs file.
   */
  figma: { path: string; generated?: string; coverage: SpecCoverage[] } | null;
  summary: SnapshotSummary;
  /** Contrast results as computed when the snapshot was written (the model recomputes the same from files). */
  contrast: { path?: string; pairs: SnapshotContrastPair[] };
  audits: SnapshotAudit[];
  /** What could not be read when the snapshot was written. */
  problems: string[];
}

export class SnapshotError extends Error {}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

/** Validates a snapshot (text or parsed JSON). Throws SnapshotError naming the first problem. */
export function parseSnapshot(input: string | unknown): RepoSnapshot {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      throw new SnapshotError(`${SNAPSHOT_FILE} is not valid JSON (${(err as Error).message})`);
    }
  }
  if (!isObj(data) || data.kind !== 'bridge-snapshot') throw new SnapshotError(`${SNAPSHOT_FILE} is not a Bridge snapshot`);
  if (data.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) throw new SnapshotError(`${SNAPSHOT_FILE} is schema version ${String(data.schemaVersion)}; this version of Bridge reads ${SNAPSHOT_SCHEMA_VERSION}`);
  const repo = data.repo;
  if (!isObj(repo) || !isStr(repo.owner) || !isStr(repo.name) || !isStr(repo.branch)) throw new SnapshotError(`${SNAPSHOT_FILE}: repo needs owner, name and branch`);
  if (!isStr(data.sourceSha) || !data.sourceSha) throw new SnapshotError(`${SNAPSHOT_FILE}: sourceSha is missing`);
  if (!isStr(data.generatedAt)) throw new SnapshotError(`${SNAPSHOT_FILE}: generatedAt is missing`);
  if (!Array.isArray(data.paths) || !data.paths.every(isStr)) throw new SnapshotError(`${SNAPSHOT_FILE}: paths must be a list of strings`);
  if (!isObj(data.files) || !Object.values(data.files).every(isStr)) throw new SnapshotError(`${SNAPSHOT_FILE}: files must map paths to text`);
  if (data.figma !== null && (!isObj(data.figma) || !isStr(data.figma.path) || !Array.isArray(data.figma.coverage))) throw new SnapshotError(`${SNAPSHOT_FILE}: figma must be null or { path, coverage }`);
  if (!isObj(data.summary) || typeof data.summary.tokens !== 'number') throw new SnapshotError(`${SNAPSHOT_FILE}: summary is missing`);
  if (!isObj(data.contrast) || !Array.isArray(data.contrast.pairs)) throw new SnapshotError(`${SNAPSHOT_FILE}: contrast needs pairs`);
  if (!Array.isArray(data.audits) || !data.audits.every((a) => isObj(a) && isStr(a.id) && isStr(a.path) && isObj(a.metrics))) throw new SnapshotError(`${SNAPSHOT_FILE}: audits must be a list of { id, path, metrics }`);
  if (!Array.isArray(data.problems)) throw new SnapshotError(`${SNAPSHOT_FILE}: problems must be a list`);
  return data as unknown as RepoSnapshot;
}

/** True when the snapshot was computed from `headSha` (the default branch head): use it instead of a live read. */
export const snapshotIsFresh = (snapshot: Pick<RepoSnapshot, 'sourceSha'>, headSha: string | undefined): boolean => !!headSha && snapshot.sourceSha === headSha;

/**
 * A RepoSource over a snapshot. The Figma specs path serves a compact file with the coverage only (no component
 * specs), so the model reads the coverage and leaves `specs.file` null.
 */
export function snapshotSource(snapshot: RepoSnapshot): RepoSource {
  const files = new Map(Object.entries(snapshot.files).map(([k, v]) => [normalizeRepoPath(k), v]));
  const figmaPath = snapshot.figma ? normalizeRepoPath(snapshot.figma.path) : undefined;
  if (snapshot.figma && figmaPath && !files.has(figmaPath)) {
    files.set(figmaPath, JSON.stringify({ ...(snapshot.figma.generated ? { generated: snapshot.figma.generated } : {}), coverage: snapshot.figma.coverage }));
  }
  const paths = [...new Set([...snapshot.paths.map(normalizeRepoPath), ...files.keys()])].sort();
  return {
    ref: { owner: snapshot.repo.owner, repo: snapshot.repo.name, sha: snapshot.sourceSha },
    list: async (prefix) => paths.filter((p) => isUnder(p, prefix)),
    text: async (path) => files.get(normalizeRepoPath(path)) ?? null,
  };
}

/**
 * Wraps a source and records what it lists and reads, so a snapshot carries exactly the files the model needs and
 * nothing else of the repository.
 */
export function recordingSource(source: RepoSource): { source: RepoSource; paths: Set<string>; files: Map<string, string> } {
  const paths = new Set<string>();
  const files = new Map<string, string>();
  return {
    paths,
    files,
    source: {
      get ref() {
        return source.ref;
      },
      async list(prefix) {
        const out = await source.list(prefix);
        for (const p of out) paths.add(p);
        return out;
      },
      async text(path) {
        const body = await source.text(path);
        if (body !== null) files.set(normalizeRepoPath(path), body);
        return body;
      },
    },
  };
}

/** Summary of an audit report for snapshot.json; the full report is written to `path`. */
export function snapshotAudit(id: string, report: AuditReport): SnapshotAudit {
  return {
    id,
    path: `${SNAPSHOT_AUDITS_DIR}/${id}.json`,
    ...(report.label ? { label: report.label } : {}),
    generatedAt: report.generatedAt,
    target: { path: report.target.path, files: report.target.files },
    metrics: report.metrics,
  };
}

/** A safe audit id from a label or path ("apps/admin/src" -> "apps-admin-src"). */
export const auditId = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\.json$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'audit';

export interface BuildSnapshotInput {
  model: RepoModel;
  /** From recordingSource(): what loadRepoModel listed and read. */
  paths: Iterable<string>;
  files: Map<string, string> | Record<string, string>;
  version: string;
  branch?: string;
  committedAt?: string;
  generatedAt?: string;
  audits?: SnapshotAudit[];
}

/** Every brand x theme result of a pair (the default brand per theme when the rows have no brands). */
const pairResults = (p: SnapshotContrastPair) => {
  const brands = Object.values(p.brands);
  return brands.length ? brands.flatMap((b) => Object.values(b)) : Object.values(p.modes);
};

/** Counts of a model for the snapshot summary. */
export function snapshotSummary(model: RepoModel): SnapshotSummary {
  const results = model.contrast.pairs.flatMap((p) => pairResults(p).map((r) => r.ratio >= p.min));
  const coverage = model.specs.coverage;
  const visual = coverage.filter((c) => c.status !== 'layout').length;
  const inFigma = coverage.filter((c) => c.status === 'generated' || c.status === 'drafted').length;
  return {
    tokens: model.tokens.rows.all.length + model.tokens.rows.primitives.length,
    components: model.components ? model.components.list.length : null,
    contrast: { pairs: model.contrast.pairs.length, checks: results.length, failing: results.filter((ok) => !ok).length },
    figma: coverage.length ? { inFigma, visual } : null,
  };
}

/** Assembles the snapshot from a model and the files it was read from. The specs file becomes the coverage list. */
export function buildSnapshot(input: BuildSnapshotInput): RepoSnapshot {
  const { model } = input;
  const files: Record<string, string> = {};
  const entries = input.files instanceof Map ? [...input.files] : Object.entries(input.files);
  const specsPath = normalizeRepoPath(model.specs.path);
  for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const p = normalizeRepoPath(k);
    if (p !== specsPath) files[p] = v;
  }
  const hasSpecs = entries.some(([k]) => normalizeRepoPath(k) === specsPath);
  return {
    kind: 'bridge-snapshot',
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    tool: { name: 'bridge', version: input.version },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    repo: { owner: model.ref.owner || model.site.owner, name: model.ref.repo || model.site.repo, branch: input.branch ?? model.site.defaultBranch },
    sourceSha: model.ref.sha,
    ...(input.committedAt ? { committedAt: input.committedAt } : {}),
    paths: [...new Set([...input.paths].map(normalizeRepoPath))].filter((p) => p !== specsPath).sort(),
    files,
    figma: hasSpecs ? { path: specsPath, ...(model.specs.file?.generated ? { generated: model.specs.file.generated } : {}), coverage: model.specs.coverage } : null,
    summary: snapshotSummary(model),
    contrast: { ...(model.contrast.path ? { path: model.contrast.path } : {}), pairs: model.contrast.pairs.map(({ fgToken: _fg, bgToken: _bg, ...rest }) => rest) },
    audits: input.audits ?? [],
    problems: [...model.problems],
  };
}

/** llms.txt next to snapshot.json on the bridge-data branch: the published design system in plain text, for agents. */
export const SNAPSHOT_LLMS_FILE = 'llms.txt';

/** Above this many tokens, llms.txt lists the first ones and points at snapshot.json for the rest. */
export const LLMS_MAX_TOKENS = 600;

/** One line of repo text: whitespace collapsed, so a value cannot open a heading or a list of its own. */
const line = (text: unknown): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '');
const strings = (list: unknown): string[] => (Array.isArray(list) ? list.map(line).filter(Boolean) : []);

/**
 * The design system of a snapshot as llms.txt (https://llmstxt.org): what it is, every token with its CSS variable and
 * values per theme, and every component with its usage guidance. Written by `bridge snapshot`; the hosted Library
 * links to it. Pure: the model the snapshot was computed from goes in, text comes out.
 */
export function snapshotLlmsTxt(model: RepoModel, snapshot: Pick<RepoSnapshot, 'repo' | 'sourceSha' | 'committedAt' | 'generatedAt'>): string {
  const { owner, name, branch } = snapshot.repo;
  const date = (snapshot.committedAt ?? snapshot.generatedAt).slice(0, 10);
  const rows = model.tokens.rows;
  const tokens = rows.all.filter((t) => !t.deprecated);
  const shown = tokens.slice(0, LLMS_MAX_TOKENS);
  const comps = model.components?.list ?? [];
  const out: string[] = [
    `# ${owner}/${name} design system`,
    '',
    `> Tokens, components and usage guidance of the design system in github.com/${owner}/${name}, read at ${snapshot.sourceSha.slice(0, 7)} on ${branch} (${date}). Published by Bridge for AI agents and people.`,
    '',
    `- Source: https://github.com/${owner}/${name}/tree/${snapshot.sourceSha}`,
    `- Every file Bridge read, as JSON: ${SNAPSHOT_FILE}, next to this file on the ${SNAPSHOT_BRANCH} branch.`,
    `- Themes: ${rows.themes.join(', ') || 'none'}. Brands: ${rows.brands.join(', ') || 'none'}. Densities: ${rows.densities.join(', ') || 'none'}.`,
    '',
    '## Tokens',
    '',
    `${tokens.length} tokens (brand, semantic, density and component tiers) on top of ${rows.primitives.length} primitives. Use the semantic tokens in product code, never the primitives. Values are for the default brand${rows.defaultBrand ? ` (${rows.defaultBrand})` : ''}.`,
    '',
  ];
  for (const t of shown) {
    const values = Object.entries(t.modes)
      .map(([theme, v]) => `${theme} ${line(v.css)}`)
      .join(', ');
    const note = line(t.description);
    out.push(`- \`${t.path}\` (\`${t.cssVar}\`, ${t.tier} ${t.type}): ${values || 'no value'}${note ? `. ${note}` : ''}`);
  }
  if (tokens.length > shown.length) out.push('', `${tokens.length - shown.length} more tokens are in ${SNAPSHOT_FILE}.`);
  out.push('', '## Components', '');
  if (!comps.length) out.push('No components were read (components.dir in bridge.config.json names the folder).');
  for (const c of comps) {
    const d = c.docs;
    out.push(`### ${line(c.name)}`, '');
    const summary = line(d?.summary) || line(c.description);
    if (summary) out.push(summary, '');
    out.push(`- Family: ${line(c.category)}${c.docs?.status && c.docs.status !== 'stable' ? `, ${c.docs.status}` : ''}`);
    if (c.allTokenPaths.length) out.push(`- Tokens: ${c.allTokenPaths.slice(0, 40).join(', ')}${c.allTokenPaths.length > 40 ? ', ...' : ''}`);
    for (const [label, list] of [
      ['Use it for', strings(d?.whenToUse)],
      ['Not for', strings(d?.whenNotToUse)],
      ['Accessibility', strings(d?.accessibility)],
    ] as const) {
      if (list.length) out.push(`- ${label}:`, ...list.map((x) => `  - ${x}`));
    }
    const dos = Array.isArray(d?.dos) ? d!.dos : [];
    const donts = Array.isArray(d?.donts) ? d!.donts : [];
    for (const g of dos) if (line(g?.title)) out.push(`- Do: ${line(g.title)}${line(g.text) ? `. ${line(g.text)}` : ''}`);
    for (const g of donts) if (line(g?.title)) out.push(`- Don't: ${line(g.title)}${line(g.text) ? `. ${line(g.text)}` : ''}`);
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
