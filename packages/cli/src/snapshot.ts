// bridge snapshot: the repo model of this checkout, written for the bridge-data branch (hosted Studio and Library
// read it from the raw host, no API quota). Adds what only Node can compute: adoption audits of product folders.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { AuditReport } from '@bridge-ds/core/audit';
import { auditId, buildSnapshot, loadRepoModel, recordingSource, snapshotAudit, snapshotLlmsTxt, SNAPSHOT_AUDITS_DIR, SNAPSHOT_FILE, SNAPSHOT_LLMS_FILE, SNAPSHOT_MAX_BYTES, type RepoSnapshot, type SnapshotAudit } from '@bridge-ds/core';
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
}

export interface SnapshotResult {
  snapshot: RepoSnapshot;
  /** Files written, relative to out. */
  written: string[];
  bytes: number;
}

const git = (root: string, args: string[]) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

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

  const snapshot = buildSnapshot({
    model,
    paths: rec.paths,
    files: rec.files,
    version: opts.version,
    ...(opts.branch ? { branch: opts.branch } : {}),
    ...(git(opts.root, ['log', '-1', '--format=%cI']) ? { committedAt: git(opts.root, ['log', '-1', '--format=%cI']) } : {}),
    ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    audits: [...audits.values()].map((a) => a.summary),
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
  return { snapshot, written, bytes };
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
    `  audits        ${s.audits.length ? s.audits.map((a) => a.path).join(', ') : 'none (--audit <path> or --audit-report <file|dir>)'}`,
    ...s.problems.map((p) => `  problem       ${p}`),
  ];
}
