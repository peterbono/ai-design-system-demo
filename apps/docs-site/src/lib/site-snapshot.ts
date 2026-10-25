// Bridge's own Library reads the same data a team's Library reads: a repo snapshot (@bridge-ds/core buildSnapshot,
// the shape `bridge snapshot` publishes to a team's bridge-data branch), built here at build time from the files the
// build-time model read (lib/model.ts modelReads), with this build's releases and workspace packages. The Library
// pages render from `libraryModel`, loaded from that snapshot through snapshotSource() exactly as a team shell loads
// its published one, so Bridge's static pages and every team's Library go through one model and one set of views.
// Studio and the other build-time pages keep the full checkout model (lib/model.ts), which also carries the Figma
// specs file a snapshot leaves out.
import { buildSnapshot, loadRepoModel, snapshotSource, type RepoModel, type RepoSnapshot, type SnapshotPackage } from '@bridge-ds/core';
import { releases } from './changelog';
import { modelReads, repoModel, tokenHref } from './model';
import { exists, git, readJson } from './repo';

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  workspaces?: string[];
}

/** The workspace packages of this checkout (root package.json "workspaces", exact folders), sorted by folder. */
export function sitePackages(): SnapshotPackage[] {
  const dirs = readJson<PackageJson>('package.json').workspaces ?? [];
  return dirs
    .filter((dir) => !dir.includes('*') && exists(`${dir}/package.json`))
    .map((dir) => ({ dir, pj: readJson<PackageJson>(`${dir}/package.json`) }))
    .filter(({ pj }) => !!pj.name)
    .map(({ dir, pj }) => ({ name: pj.name!, version: pj.version ?? '0.0.0', private: Boolean(pj.private), dir }))
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

function build(): RepoSnapshot {
  const committedAt = git(['log', '-1', '--format=%cI']);
  const snap = buildSnapshot({
    model: repoModel,
    paths: modelReads.paths,
    files: modelReads.files,
    version: readJson<PackageJson>('packages/cli/package.json').version ?? '0.0.0',
    ...(committedAt ? { committedAt } : {}),
    // The rows a snapshot carries: the releases without their worded announcement (the views word it).
    releases: releases().map(({ announcement: _a, ...row }) => row),
    packages: sitePackages(),
  });
  return { ...snap, sourceSha: snap.sourceSha || git(['rev-parse', 'HEAD']) || 'local' };
}

/** This build's snapshot of the checkout, the same shape a team publishes. */
export const siteSnapshot: RepoSnapshot = build();

/** The model Bridge's own Library pages render from: the snapshot read back, as a team's Library reads its own. */
export const libraryModel: RepoModel = await loadRepoModel(snapshotSource(siteSnapshot), { href: tokenHref });
