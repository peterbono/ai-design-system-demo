// bridge snapshot: the repo model of this checkout, written for the bridge-data branch (hosted Studio and Library
// read it from the raw host, no API quota). Adds what only Node can compute: adoption audits of product folders.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, posix, relative, resolve } from 'node:path';
import type { AuditReport } from '@bridge-ds/core/audit';
import { ACTIVITY_FILE, activityBytes, auditId, buildSnapshot, collectActivity, collectReleases, GitHubClient, loadRepoModel, parseActivity, recordingSource, snapshotAudit, snapshotLlmsTxt, SNAPSHOT_AUDITS_DIR, SNAPSHOT_BRANCH, SNAPSHOT_FILE, SNAPSHOT_LLMS_FILE, SNAPSHOT_MAX_BYTES, type FetchLike, type RepoActivity, type RepoSnapshot, type SnapshotAudit, type SnapshotPackage } from '@bridge-ds/core';
import { fsSource, runAudit } from '@bridge-ds/core/node';

export interface SnapshotOptions {
  root: string;
  /** Output folder (the content of the bridge-data branch). */
  out: string;
  version: string;
  /** Product folders to audit now (relative to root or absolute). `path=label` names the report. */
  audit?: string[];
  /** Existing `bridge audit --json` reports to carry: files or folders of them. */
  auditReports?: string[];
  branch?: string;
  /** Fixed timestamp (tests). */
  generatedAt?: string;
  /**
   * Also write activity.json: the team's open branches, suggestions, requests, recent merges and token history, read
   * from GitHub with this token, so a signed-out visitor of the hosted Studio spends no API request.
   */
  activity?: {
    token: string;
    /** "owner/name"; else the snapshot's repository. */
    repo?: string;
    /** fetch for api.github.com (tests). */
    fetch?: FetchLike;
  };
}

export interface SnapshotResult {
  snapshot: RepoSnapshot;
  /** The activity written next to it (--activity), with its size. */
  activity?: { activity: RepoActivity; bytes: number; reused: boolean };
  /** Files written, relative to out. */
  written: string[];
  bytes: number;
  /** Where the release dates came from, for the summary: tags, history, or none (a shallow clone without tags). */
  releaseDates?: string;
}

const git = (root: string, args: string[]) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const readJsonFile = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

/** Workspace globs of the root package.json ("workspaces", or "workspaces.packages") or pnpm-workspace.yaml. */
function workspaceGlobs(root: string): string[] {
  const pj = readJsonFile<{ workspaces?: string[] | { packages?: string[] } }>(join(root, 'package.json'));
  const ws = Array.isArray(pj?.workspaces) ? pj.workspaces : (pj?.workspaces?.packages ?? []);
  if (ws.length) return ws;
  const pnpm = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(pnpm)) return [];
  const block = /^packages:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m.exec(readFileSync(pnpm, 'utf8'))?.[1] ?? '';
  return [...block.matchAll(/^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*$/gm)].map((m) => m[1]!);
}

/**
 * The repository's packages: each workspace folder with a named package.json ("dir/*" and exact folders; negated and
 * deeper globs are skipped), else the root package. Sorted by folder.
 */
export function workspacePackages(root: string): SnapshotPackage[] {
  const dirs = new Set<string>();
  for (const glob of workspaceGlobs(root)) {
    if (glob.startsWith('!')) continue;
    const g = posix.normalize(glob.replace(/\/+$/, ''));
    if (g.endsWith('/*') && !g.slice(0, -2).includes('*')) {
      const parent = g.slice(0, -2);
      if (!existsSync(join(root, parent))) continue;
      for (const n of readdirSync(join(root, parent)).sort()) if (statSync(join(root, parent, n)).isDirectory()) dirs.add(`${parent}/${n}`);
    } else if (!g.includes('*')) dirs.add(g);
  }
  if (!dirs.size) dirs.add('.');
  const out: SnapshotPackage[] = [];
  for (const dir of dirs) {
    const pj = readJsonFile<{ name?: string; version?: string; private?: boolean }>(join(root, dir, 'package.json'));
    if (!pj?.name) continue;
    out.push({ name: pj.name, version: pj.version ?? '0.0.0', private: Boolean(pj.private), dir });
  }
  return out.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

/**
 * Releases from the packages' CHANGELOG.md files and .changeset/*.md, dated by release tags ("@acme/ui@1.2.0"), else
 * by the commit that added the version heading. A shallow clone (actions/checkout's default) has no history to read
 * a heading's date from: only tags date it there, and no date is ever guessed.
 */
function readReleases(root: string, packages: SnapshotPackage[], libraryDir: string | undefined) {
  const withLog = packages.filter((p) => existsSync(join(root, p.dir, 'CHANGELOG.md')));
  const changelogs = withLog.map((p) => ({ pkg: p.name, published: !p.private, text: readFileSync(join(root, p.dir, 'CHANGELOG.md'), 'utf8') }));
  const csDir = join(root, '.changeset');
  const changesets = existsSync(csDir)
    ? readdirSync(csDir)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .sort()
        .map((f) => ({ ref: `.changeset/${f}`, text: readFileSync(join(csDir, f), 'utf8') }))
    : [];
  if (!changelogs.length && !changesets.length) return null;
  const tags = new Map<string, string>();
  for (const line of git(root, ['for-each-ref', '--format=%(refname:short)\t%(creatordate:short)', 'refs/tags/']).split('\n')) {
    const [tag, date] = line.split('\t');
    if (tag && date && /@\d+\.\d+\.\d+/.test(tag)) tags.set(tag, date);
  }
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']) !== 'false';
  const fileOf = new Map(withLog.map((p) => [p.name, posix.join(p.dir, 'CHANGELOG.md')]));
  let fromTags = 0;
  let fromLog = 0;
  const dateOf = (pkg: string, version: string) => {
    const tagged = tags.get(`${pkg}@${version}`);
    if (tagged) {
      fromTags++;
      return tagged;
    }
    const file = fileOf.get(pkg);
    if (shallow || !file) return undefined;
    const dates = git(root, ['log', '--format=%cs', '-S', `## ${version}\n`, '--', file]).split('\n').filter(Boolean);
    const d = dates[dates.length - 1];
    if (d) fromLog++;
    return d;
  };
  const lib = (libraryDir && packages.find((p) => p.dir !== '.' && (libraryDir === p.dir || libraryDir.startsWith(`${p.dir}/`)))) || packages.find((p) => !p.private) || packages[0];
  const releases = collectReleases({ changelogs, changesets, dateOf, ...(lib ? { libraryPackage: lib.name } : {}) });
  const dates = fromTags || fromLog ? [fromTags && 'release tags', fromLog && 'git history'].filter(Boolean).join(' and ') : shallow ? 'none (shallow clone without release tags)' : 'none';
  return { releases, dates };
}

const isReport = (x: unknown): x is AuditReport => {
  const r = x as AuditReport | null;
  return !!r && typeof r === 'object' && r.schemaVersion === 1 && typeof r.generatedAt === 'string' && !!r.metrics && Array.isArray(r.files);
};

function reportFiles(root: string, entry: string): string[] {
  const abs = resolve(root, entry);
  if (!existsSync(abs)) throw new Error(`Audit report not found: ${entry}`);
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => join(abs, n));
}

export async function writeSnapshot(opts: SnapshotOptions): Promise<SnapshotResult> {
  const rec = recordingSource(fsSource(opts.root));
  const model = await loadRepoModel(rec.source);

  // Adoption audits: reports carried from files, then fresh runs. An id used twice keeps the last one.
  const audits = new Map<string, { summary: SnapshotAudit; report: AuditReport }>();
  for (const entry of opts.auditReports ?? []) {
    for (const file of reportFiles(opts.root, entry)) {
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(file, 'utf8'));
      } catch (err) {
        throw new Error(`${relative(opts.root, file)} is not valid JSON (${(err as Error).message})`);
      }
      if (!isReport(data)) continue; // not an audit report (schema version 1): skipped
      const id = auditId(basename(file));
      audits.set(id, { summary: snapshotAudit(id, data), report: data });
    }
  }
  for (const spec of opts.audit ?? []) {
    const [path, label] = spec.split(/=(.*)/s, 2) as [string, string | undefined];
    const abs = resolve(opts.root, path);
    if (!existsSync(abs)) throw new Error(`No such file or folder to audit: ${path}`);
    const report = runAudit(abs, { ds: opts.root, version: opts.version, ...(label ? { label } : {}) });
    const id = auditId(label || relative(opts.root, abs) || basename(abs));
    audits.set(id, { summary: snapshotAudit(id, report), report });
  }

  const packages = workspacePackages(opts.root);
  const rel = readReleases(opts.root, packages, model.components?.dir);
  const snapshot = buildSnapshot({
    model,
    paths: rec.paths,
    files: rec.files,
    version: opts.version,
    ...(opts.branch ? { branch: opts.branch } : {}),
    ...(git(opts.root, ['log', '-1', '--format=%cI']) ? { committedAt: git(opts.root, ['log', '-1', '--format=%cI']) } : {}),
    ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    audits: [...audits.values()].map((a) => a.summary),
    ...(packages.length ? { packages } : {}),
    ...(rel ? { releases: rel.releases } : {}),
  });
  const text = `${JSON.stringify(snapshot)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > SNAPSHOT_MAX_BYTES) throw new Error(`${SNAPSHOT_FILE} would be ${(bytes / 1e6).toFixed(1)} MB, over the ${SNAPSHOT_MAX_BYTES / 1e6} MB limit: is tokens.root or components.dir too wide in bridge.config.json?`);

  // The folder is the branch content: start clean so removed audits do not linger.
  rmSync(join(opts.out, SNAPSHOT_AUDITS_DIR), { recursive: true, force: true });
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, SNAPSHOT_FILE), text);
  // The same design system as plain text for agents; the hosted Library links to it.
  writeFileSync(join(opts.out, SNAPSHOT_LLMS_FILE), snapshotLlmsTxt(model, snapshot));
  const written = [SNAPSHOT_FILE, SNAPSHOT_LLMS_FILE];
  if (audits.size) mkdirSync(join(opts.out, SNAPSHOT_AUDITS_DIR), { recursive: true });
  for (const { summary, report } of audits.values()) {
    writeFileSync(join(opts.out, summary.path), `${JSON.stringify(report)}\n`);
    written.push(summary.path);
  }
  let activity: SnapshotResult['activity'];
  if (opts.activity) {
    const [owner, name] = (opts.activity.repo ?? `${snapshot.repo.owner}/${snapshot.repo.name}`).split('/') as [string, string];
    if (!owner || !name) throw new Error('bridge snapshot --activity needs the repository: --repo owner/name, GITHUB_REPOSITORY, or "repo" in bridge.config.json.');
    const fetchImpl: FetchLike = opts.activity.fetch ?? ((url, init) => fetch(url, init));
    // The last published activity: its token history is kept while the default branch head has not moved.
    const previous = await new GitHubClient(`${owner}/${name}`, opts.activity.token, fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => {} }, { etags: false })
      .getRawText(ACTIVITY_FILE, SNAPSHOT_BRANCH)
      .then((t) => (t ? parseActivity(t) : null))
      .catch(() => null);
    const a = await collectActivity({ fetch: fetchImpl, token: opts.activity.token, owner, repo: name, config: model.config, version: opts.version, ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}), previous });
    writeFileSync(join(opts.out, ACTIVITY_FILE), `${JSON.stringify(a)}\n`);
    written.push(ACTIVITY_FILE);
    activity = { activity: a, bytes: activityBytes(a), reused: Boolean(previous && a.history && previous.history === a.history) };
  }
  return { snapshot, written, bytes, ...(rel ? { releaseDates: rel.dates } : {}), ...(activity ? { activity } : {}) };
}

/** What `bridge snapshot` prints: one line per fact, for the terminal and the workflow summary. */
export function snapshotLines(r: SnapshotResult, out: string): string[] {
  const s = r.snapshot;
  const c = s.summary.contrast;
  const kb = Math.max(1, Math.round(r.bytes / 1024));
  return [
    `Wrote ${join(out, SNAPSHOT_FILE)} (${kb} KB) for ${s.repo.owner}/${s.repo.name} at ${s.sourceSha.slice(0, 7)}.`,
    `  tokens        ${s.summary.tokens}`,
    `  components    ${s.summary.components ?? 'not scanned'}`,
    `  contrast      ${c.checks} checks over ${c.pairs} pairs, ${c.failing} failing`,
    `  figma         ${s.summary.figma ? `${s.summary.figma.inFigma} of ${s.summary.figma.visual} visual components` : 'no component-specs.json'}`,
    `  packages      ${s.packages?.length ?? 0}`,
    `  releases      ${s.releases ? `${s.releases.filter((x) => !x.pending).length} published${s.releases.some((x) => x.pending) ? ', 1 pending' : ''}, dates from ${r.releaseDates ?? 'none'}` : 'no CHANGELOG.md or .changeset'}`,
    `  motion        ${s.motion ? `${Object.values(s.motion).filter((m) => m.rows.length).length} of ${Object.keys(s.motion).length} components animate` : 'no component-specs.json'}`,
    `  audits        ${s.audits.length ? s.audits.map((a) => a.path).join(', ') : 'none (--audit <path> or --audit-report <file|dir>)'}`,
    ...s.problems.map((p) => `  problem       ${p}`),
    ...activityLines(r, out),
  ];
}

/** The activity lines of `bridge snapshot --activity`. */
function activityLines(r: SnapshotResult, out: string): string[] {
  if (!r.activity) return [];
  const a = r.activity.activity;
  const kb = Math.max(1, Math.round(r.activity.bytes / 1024));
  const reads = Object.keys(a.responses).length;
  return [
    `Wrote ${join(out, ACTIVITY_FILE)} (${kb} KB): ${reads} GitHub reads recorded for signed-out visitors.`,
    `  branches      ${a.branches.length} open`,
    `  suggestions   ${a.suggestions.length} open`,
    `  requests      ${a.requests.length}`,
    `  merged        ${a.merged.length} recent`,
    `  history       ${a.history ? `${a.history.entries.length} token changes${r.activity.reused ? ' (kept: the default branch did not move)' : ''}` : 'not read'}`,
    ...a.truncated.map((t) => `  left out      ${t}`),
    ...a.problems.map((p) => `  problem       ${p}`),
  ];
}
