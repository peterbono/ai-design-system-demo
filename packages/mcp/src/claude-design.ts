// The Bridge Library in Claude Design: bridge_get_claude_design_system and bridge_set_claude_design_system_url.
//
// Artifacts are only published from a Claude session, so Bridge never publishes them itself. Each docs-site deploy
// serves the Library as a Claude Design System per version (scripts/claude-design-system/release.mjs):
//   <site>/claude-design-system/manifest.json              the version this deploy serves: path, size, sha256 per file
//   <site>/claude-design-system/<version>/project/<...>    the files, at the paths the artifact publishes them
// The team's Claude reads the manifest through bridge_get_claude_design_system, creates the Design System artifact the
// first time, then republishes only the files whose sha256 changed to the same artifact, and tells Bridge with
// bridge_set_claude_design_system_url: the team setting keeps the address, the version and the hashes it published,
// so the next update lists only what changed. Saving that setting is for the team's admins and leads (Admin or
// Reviewer in bridge_whoami), checked here on the server.
import type { BridgeContext } from './context.js';
import { BRIDGE_SITE_URL } from './site.js';
import { whoami, type WhoAmIRole } from './whoami.js';

/** One file of the served system, at the path the Design System artifact publishes it. */
export interface ClaudeDesignFile {
  path: string;
  size: number;
  sha256: string;
}

/** The manifest the site serves (scripts/claude-design-system/lib.mjs buildManifest). */
export interface ClaudeDesignManifest {
  format: number;
  name: string;
  package: string;
  version: string;
  revision: string;
  /** Site-relative folder of this version, ending with a slash: a file is at base + path. */
  base: string;
  count: number;
  bytes: number;
  files: ClaudeDesignFile[];
}

/** What the team setting keeps (the hosted connector stores it with the team, api/_lib/teams.ts). */
export interface TeamClaudeDesign {
  url: string;
  version: string;
  revision?: string | undefined;
  /** path -> sha256 of what was published, so the next update lists only what changed. */
  files?: Record<string, string> | undefined;
  at: string;
  by?: string | undefined;
}

/** Where the system comes from and where the team's artifact is remembered. Given by the host (api/mcp). */
export interface ClaudeDesignHost {
  /** The Bridge site that serves it (default: the public Bridge site). */
  site?: string | undefined;
  /** Fetch for the site (default: global fetch). Never the GitHub fetch of the context. */
  fetch?: typeof fetch | undefined;
  /** The team setting, when the server keeps one (the hosted connector). */
  read?: (() => Promise<TeamClaudeDesign | null>) | undefined;
  save?: ((value: TeamClaudeDesign) => Promise<void>) | undefined;
}

export const MANIFEST_PATH = '/claude-design-system/manifest.json';
/** A Claude artifact address: claude.ai/artifact/<id> or claude.ai/code/artifact/<uuid>. */
export const ARTIFACT_URL = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]{6,64}\/?$/;
/** Who may save the team's artifact address: admins and leads. */
export const CAN_SET_ROLES: readonly WhoAmIRole[] = ['Admin', 'Reviewer'];
/** The files a call may inline (the rest are fetched from their URL): enough for the docs, never the bundle. */
export const INLINE_MAX_BYTES = 256 * 1024;

export const CLAUDE_DESIGN_WORDS = {
  unreachable: (site: string) => `Bridge could not read the Library for Claude Design from ${site}. Try again in a minute.`,
  badManifest: 'The Library for Claude Design that Bridge serves is not readable. Tell the Bridge team.',
  badUrl: 'That is not the address of a Claude artifact. Use the link of the Design System artifact, like https://claude.ai/artifact/AbC123.',
  notAllowed: 'Only admins and leads of this team save where its Library lives in Claude Design.',
  noSetting: 'This Bridge server does not keep team settings. Connect Bridge in Claude (the Bridge connector) to remember the address for the team.',
  // MCP only: these tools have no CLI command.
  oldVersion: (asked: string, served: string) => `Bridge serves the Library ${served} now, not ${asked}. Call bridge_get_claude_design_system again and publish ${served}.`,
} as const;

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function hostOf(ctx: BridgeContext): Required<Pick<ClaudeDesignHost, 'site' | 'fetch'>> & ClaudeDesignHost {
  const h = ctx.opts.claudeDesign ?? {};
  return { ...h, site: trimSlash(h.site ?? BRIDGE_SITE_URL), fetch: h.fetch ?? fetch };
}

/** A manifest as served, checked: anything else is refused rather than half-used. */
export function parseManifest(v: unknown): ClaudeDesignManifest | null {
  const m = v as Partial<ClaudeDesignManifest> | null;
  if (!m || typeof m !== 'object' || m.format !== 1 || typeof m.version !== 'string' || typeof m.base !== 'string' || !Array.isArray(m.files)) return null;
  const files = m.files.filter((f): f is ClaudeDesignFile => Boolean(f) && typeof f.path === 'string' && /^project\/[\w./-]+$/.test(f.path) && !f.path.includes('..') && typeof f.size === 'number' && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256));
  if (files.length !== m.files.length || !files.length) return null;
  return {
    format: 1,
    name: typeof m.name === 'string' ? m.name : 'Bridge Library',
    package: typeof m.package === 'string' ? m.package : '@bridge-ds/react',
    version: m.version,
    revision: typeof m.revision === 'string' ? m.revision : '',
    base: m.base.endsWith('/') ? m.base : `${m.base}/`,
    count: files.length,
    bytes: files.reduce((n, f) => n + f.size, 0),
    files,
  };
}

/** The manifest the site serves now. */
export async function readManifest(ctx: BridgeContext): Promise<{ manifest: ClaudeDesignManifest; site: string }> {
  const { site, fetch: f } = hostOf(ctx);
  const r = await f(`${site}${MANIFEST_PATH}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  if (!r || !r.ok) throw new Error(CLAUDE_DESIGN_WORDS.unreachable(site));
  const manifest = parseManifest(await r.json().catch(() => null));
  if (!manifest) throw new Error(CLAUDE_DESIGN_WORDS.badManifest);
  return { manifest, site };
}

/** What changed since what the team published: paths to publish again and paths to remove. */
export function diffFiles(manifest: ClaudeDesignManifest, published: Record<string, string> | undefined): { changed: string[]; removed: string[] } | null {
  if (!published) return null;
  const now = new Set(manifest.files.map((f) => f.path));
  return {
    changed: manifest.files.filter((f) => published[f.path] !== f.sha256).map((f) => f.path),
    removed: Object.keys(published).filter((p) => !now.has(p)).sort(),
  };
}

export type ClaudeDesignAction = 'create' | 'update' | 'none';

/** The steps for the team's Claude, in a few sentences. */
export function instructionsFor(x: { action: ClaudeDesignAction; version: string; artifact: string | null; changedKnown: boolean; name: string }): string {
  const fetchStep = `Download each file from its url (keep the path) and check its sha256 against the manifest before publishing.`;
  const order = `Publish the files under exactly the manifest paths (project/...), project/design-system.json last.`;
  const canvases = `Then, in every Claude Design canvas that installs the ${x.name}, re-run its install at version ${x.version} (the Design canvas rules), so the canvas loads the new bundle.`;
  if (x.action === 'none') return `The team's ${x.name} in Claude Design (${x.artifact}) is already ${x.version}: nothing to publish. If a canvas still shows an older version, re-run its install at version ${x.version}.`;
  if (x.action === 'create')
    return [
      `The team has no ${x.name} in Claude Design yet. Create it once: start a new artifact from the Design System type titled "${x.name}".`,
      fetchStep,
      order,
      // MCP only
      `Then call bridge_set_claude_design_system_url with the artifact URL and version ${x.version}, so Bridge remembers it for the team (admins and leads only).`,
      `Canvases install it from that artifact.`,
    ].join(' ');
  return [
    `Update the team's ${x.name} in Claude Design to ${x.version}: publish to the same artifact URL, ${x.artifact}, never a new one.`,
    x.changedKnown ? `Republish ONLY the files listed in "changed", and remove the ones in "removed".` : `Bridge does not know what that artifact holds: compare the manifest with the artifact's files and republish only the ones that differ.`,
    fetchStep,
    order,
    // MCP only
    `Then call bridge_set_claude_design_system_url with the same URL and version ${x.version}.`,
    canvases,
  ].join(' ');
}

export interface GetClaudeDesignArgs {
  /** Paths (project/...) whose text to inline in the answer, up to INLINE_MAX_BYTES in total. */
  inline?: string[] | undefined;
}

export interface ClaudeDesignAnswer {
  name: string;
  package: string;
  version: string;
  revision: string;
  /** Absolute folder of this version: a file is at base + path. */
  base: string;
  manifest: { url: string; count: number; bytes: number; files: (ClaudeDesignFile & { url: string })[] };
  team: { url: string; version: string; at: string } | null;
  action: ClaudeDesignAction;
  /** Paths to republish (update with a known artifact), null when Bridge does not know what the artifact holds. */
  changed: string[] | null;
  removed: string[] | null;
  /** The inlined files, path -> text. */
  files?: Record<string, string>;
  instructions: string;
}

/** bridge_get_claude_design_system */
export async function getClaudeDesignSystem(ctx: BridgeContext, args: GetClaudeDesignArgs = {}): Promise<ClaudeDesignAnswer> {
  const { manifest, site } = await readManifest(ctx);
  const host = hostOf(ctx);
  const team = host.read ? await host.read().catch(() => null) : null;
  const base = `${site}${manifest.base}`;
  const diff = team ? diffFiles(manifest, team.files) : null;
  const action: ClaudeDesignAction = !team ? 'create' : team.version === manifest.version && diff && !diff.changed.length && !diff.removed.length ? 'none' : 'update';
  const answer: ClaudeDesignAnswer = {
    name: manifest.name,
    package: manifest.package,
    version: manifest.version,
    revision: manifest.revision,
    base,
    manifest: { url: `${site}${MANIFEST_PATH}`, count: manifest.count, bytes: manifest.bytes, files: manifest.files.map((f) => ({ ...f, url: `${base}${f.path}` })) },
    team: team ? { url: team.url, version: team.version, at: team.at } : null,
    action,
    changed: action === 'create' ? manifest.files.map((f) => f.path) : diff ? diff.changed : null,
    removed: action === 'create' ? [] : diff ? diff.removed : null,
    instructions: instructionsFor({ action, version: manifest.version, artifact: team?.url ?? null, changedKnown: Boolean(diff), name: manifest.name }),
  };
  const wanted = [...new Set(args.inline ?? [])];
  if (wanted.length) {
    const byPath = new Map(manifest.files.map((f) => [f.path, f]));
    const unknown = wanted.filter((p) => !byPath.has(p));
    if (unknown.length) throw new Error(`Not in the manifest: ${unknown.join(', ')}. Use the paths it lists (project/...).`);
    const total = wanted.reduce((n, p) => n + byPath.get(p)!.size, 0);
    if (total > INLINE_MAX_BYTES) throw new Error(`Those files are ${Math.ceil(total / 1024)} kB together; inline at most ${INLINE_MAX_BYTES / 1024} kB per call and download the others from their url.`);
    const files: Record<string, string> = {};
    for (const p of wanted) {
      const r = await host.fetch(`${base}${p}`).catch(() => null);
      if (!r || !r.ok) throw new Error(CLAUDE_DESIGN_WORDS.unreachable(site));
      files[p] = await r.text();
    }
    answer.files = files;
  }
  return answer;
}

export interface SetClaudeDesignArgs {
  url: string;
  /** The version just published (default: the one the site serves now). */
  version?: string | undefined;
}

/** bridge_set_claude_design_system_url: admins and leads only, checked on the server. */
export async function setClaudeDesignSystemUrl(ctx: BridgeContext, args: SetClaudeDesignArgs): Promise<{ saved: Omit<TeamClaudeDesign, 'files'>; files: number; said: string }> {
  const host = hostOf(ctx);
  if (!host.save) throw new Error(CLAUDE_DESIGN_WORDS.noSetting);
  const url = String(args.url ?? '').trim();
  if (!ARTIFACT_URL.test(url)) throw new Error(CLAUDE_DESIGN_WORDS.badUrl);
  const who = await whoami(ctx);
  if (!CAN_SET_ROLES.includes(who.role)) throw new Error(CLAUDE_DESIGN_WORDS.notAllowed);
  const { manifest } = await readManifest(ctx);
  if (args.version && args.version !== manifest.version) throw new Error(CLAUDE_DESIGN_WORDS.oldVersion(args.version, manifest.version));
  const value: TeamClaudeDesign = {
    url: url.replace(/\/$/, ''),
    version: manifest.version,
    revision: manifest.revision,
    files: Object.fromEntries(manifest.files.map((f) => [f.path, f.sha256])),
    at: new Date().toISOString(),
    by: who.name,
  };
  await host.save(value);
  const { files: _files, ...saved } = value;
  return { saved, files: manifest.count, said: `Bridge remembers the team's ${manifest.name} ${manifest.version} in Claude Design at ${value.url}.` };
}
