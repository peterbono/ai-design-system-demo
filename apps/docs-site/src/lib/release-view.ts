// The next release, in plain words: read from the release pull request the changesets action keeps open
// (changeset-release/main, "Version packages"), and the Overview activity split between the design system and
// Bridge's own apps. Pure: no DOM, no fetch. Unit tested in release-view.test.ts.
import { isToolingFile, type ProductConfig, type ToolingConfig } from '@bridge-ds/core';
import { VOCAB } from './vocabulary';
import { humanTitle } from './pr-title';
import { mdTitleText } from './markdown';

export type Bump = 'major' | 'minor' | 'patch';

export interface ReleasePackage {
  /** npm name, "@bridge-ds/react". */
  name: string;
  /** Version after the release, "1.1.0". */
  version: string;
  /** Highest bump listed under the package. */
  bump: Bump;
  /** The changesets listed under the package (short commit ids, lower case), never its "Updated dependencies" lines. */
  ids?: string[];
}

export interface ReleasePlan {
  /** Distinct changesets in the release (each one is one change). */
  changes: number;
  packages: ReleasePackage[];
}

const BUMP_RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

/**
 * Reads the body the changesets action writes: "## @bridge-ds/react@1.1.0", then "### Minor Changes", then
 * "- 3d3d77d: summary" per changeset. Changes are counted once, however many packages list them; the
 * "Updated dependencies" lines are not changes.
 */
export function parseReleaseBody(body: string | null | undefined): ReleasePlan {
  const packages: ReleasePackage[] = [];
  const ids = new Set<string>();
  let current: ReleasePackage | null = null;
  let bump: Bump | null = null;
  for (const line of (body ?? '').split(/\r?\n/)) {
    const pkg = line.match(/^##\s+(@?[\w./-]+)@(\d+\.\d+\.\d+[\w.-]*)\s*$/);
    if (pkg) {
      current = { name: pkg[1]!, version: pkg[2]!, bump: 'patch', ids: [] };
      packages.push(current);
      bump = null;
      continue;
    }
    const head = line.match(/^###\s+(Major|Minor|Patch) Changes/i);
    if (head && current) {
      bump = head[1]!.toLowerCase() as Bump;
      // Patch is the lowest bump, so the highest heading wins.
      if (BUMP_RANK[bump] > BUMP_RANK[current.bump]) current.bump = bump;
      continue;
    }
    const entry = line.match(/^-\s+(?:\[?([0-9a-f]{7,40})\]?(?:\([^)]*\))?:)/i);
    if (entry && current && bump) {
      const id = entry[1]!.toLowerCase();
      ids.add(id);
      if (!current.ids!.includes(id)) current.ids!.push(id);
    }
  }
  return { changes: ids.size, packages };
}

/** Plain names: what a designer calls each package. Unknown packages keep their short name. */
const PACKAGE_WORD: Record<string, string> = {
  '@bridge-ds/react': 'Components',
  '@bridge-ds/tokens': 'Tokens',
  '@bridge-ds/figma-plugin': 'Figma plugin',
  '@bridge-ds/docs-site': 'Docs site',
  '@bridge-ds/core': 'Bridge core',
  '@bridge-ds/cli': 'Command line tool',
  '@bridge-ds/mcp': 'Claude connector',
  '@bridge-ds/visual': 'Visual checks',
  '@bridge-ds/stylelint-plugin': 'Style lint rules',
  '@bridge-ds/eslint-plugin': 'Code lint rules',
};

/** The design system itself: what product teams install. Everything else is Bridge, the tool around it. */
export const DS_PACKAGES = ['@bridge-ds/react', '@bridge-ds/tokens'];

export const packageWord = (name: string) => PACKAGE_WORD[name] ?? name.replace(/^@[\w-]+\//, '');

const BUMP_WORD: Record<Bump, string> = { major: 'action needed', minor: 'new options', patch: 'fixes' };

/** "Components 1.1.0, new options". */
export const packageLine = (p: ReleasePackage) => `${packageWord(p.name)} ${p.version}, ${BUMP_WORD[p.bump]}`;

// ---------------------------------------------------------------------------------------------------------------
// The library release: what product teams install, never Bridge's own tool packages

/** What tells a library package from the rest: bridge.config.json `tooling` and the products with a folder of their own. */
export interface LibraryScope {
  tooling?: ToolingConfig | null;
  products?: readonly Pick<ProductConfig, 'key' | 'path' | 'repo' | 'default' | 'name'>[] | null;
}

/** The folders a workspace package may live in: "@bridge-ds/react" in packages/react/ or apps/react/. */
const folders = (name: string) => {
  const short = name.replace(/^@[\w.-]+\//, '');
  return [`packages/${short}`, `apps/${short}`];
};

/**
 * Whether a package of the release is the library (what product teams install): its folder is not tooling (core
 * isToolingFile over bridge.config.json `tooling`) and not a product of this repository (a product with its own
 * folder, the Admin demo's apps/admin). A repository without `tooling` releases only its library.
 */
export function isLibraryPackage(name: string, scope: LibraryScope = {}): boolean {
  const own = (scope.products ?? []).filter((p) => !p.default && !p.repo && p.path).map((p) => p.path!.replace(/^\.?\/+|\/+$/g, ''));
  return folders(name).every((f) => !isToolingFile(`${f}/package.json`, scope.tooling ?? null) && !own.some((o) => f === o || f.startsWith(`${o}/`)));
}

/** The library part of a release: its packages and its changes (each changeset once). */
export function libraryRelease(plan: ReleasePlan, scope: LibraryScope = {}): { changes: number; packages: ReleasePackage[]; ids: Set<string> } {
  const packages = plan.packages.filter((p) => isLibraryPackage(p.name, scope));
  const ids = new Set(packages.flatMap((p) => p.ids ?? []));
  return { changes: ids.size, packages, ids };
}

/**
 * Whether a merged change waits for the library release: the release lists its changeset under a library package
 * (the changesets action names each one by the short id of the commit that added it, the change's merge commit).
 */
export function inNextRelease(mergeSha: string | null | undefined, ids: ReadonlySet<string>): boolean {
  const sha = (mergeSha ?? '').toLowerCase();
  if (sha.length < 7) return false;
  for (const id of ids) if (sha.startsWith(id)) return true;
  return false;
}

export interface ReleaseCard {
  /** "Library update ready: 3 changes. Publish so your products can update." */
  title: string;
  /** Which products receive it: "Product admin gets it when it updates @bridge-ds/react." */
  lines: string[];
  breaking: boolean;
}

const andList = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The release card of Being built, Figma-like: the library changes only (Bridge's tool updates never count). Null
 * when the release holds no library change: no card then. Under it, the products that receive it (a product with its
 * own repository gets it when it updates the library packages); without such a product, the packages in plain words.
 */
export function releaseCard(plan: ReleasePlan, scope: LibraryScope = {}): ReleaseCard | null {
  const lib = libraryRelease(plan, scope);
  if (!lib.packages.length) return null;
  const n = lib.changes || lib.packages.length;
  const names = andList(lib.packages.map((p) => p.name));
  const receivers = (scope.products ?? []).filter((p) => p.repo && !p.default);
  return {
    title: `Library update ready: ${n} ${n === 1 ? 'change' : 'changes'}. Publish so your products can update.`,
    lines: receivers.length ? receivers.map((p) => `${p.name} gets it when it updates ${names}.`) : lib.packages.map(packageLine),
    breaking: lib.packages.some((p) => p.bump === 'major'),
  };
}

/** Without a release pull request: what is live and how many changes wait (pending changesets on the main branch). */
export function waitingLine(current: string, pending: number): string {
  return `${current} is live. ${pending === 0 ? 'Nothing waits for the next release.' : `${pending} ${pending === 1 ? `${VOCAB.branch} waits` : `${VOCAB.branches} wait`} for the next release.`}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Activity: design system changes vs Bridge app updates

/** A design system change touches what product teams install (components or tokens); the rest updates Bridge. */
export const isDsChange = (packages: string[]) => packages.some((p) => DS_PACKAGES.includes(p));

export interface ActivitySplit<E> {
  ds: E[];
  app: E[];
}

/** Splits merged, unreleased entries by what they change. Entries without package data count as Bridge updates. */
export function splitActivity<E extends { packages: string[] }>(entries: E[]): ActivitySplit<E> {
  return { ds: entries.filter((e) => isDsChange(e.packages)), app: entries.filter((e) => !isDsChange(e.packages)) };
}

// ---------------------------------------------------------------------------------------------------------------
// History rows: a human summary, never a raw commit subject

export interface SummaryEntry {
  title: string;
  bulk?: boolean;
  counts: { total: number };
  pr?: { title: string } | null;
  changesets?: { summary: string }[];
}

const firstSentence = (text: string) => {
  const line = mdTitleText(text.split(/\n\s*\n/)[0]!.replace(/\s+/g, ' ').trim());
  const cut = line.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? line;
  return cut.replace(/[.\s]+$/, '');
};

/**
 * The row title of a history entry: the changeset summary the author wrote for people, else the pull request
 * title, else the commit subject, each without its conventional prefix or "(#12)". An import reads as one line.
 */
export function historySummary(e: SummaryEntry, opts: { full?: boolean } = {}): string {
  if (e.bulk) return `Large token update, ${e.counts.total.toLocaleString('en-US')} token edits`;
  const fromChangeset = e.changesets?.map((c) => c.summary).find((s) => s && s.trim());
  const raw = fromChangeset ? firstSentence(fromChangeset) : (e.pr?.title ?? e.title);
  const clean = humanTitle(mdTitleText(raw).replace(/\s*\(#\d+\)\s*$/, '').trim());
  return !opts.full && clean.length > 90 ? `${clean.slice(0, 87).replace(/\s+\S*$/, '')}...` : clean;
}
