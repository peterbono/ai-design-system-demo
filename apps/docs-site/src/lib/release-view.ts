// The next release, in plain words: read from the release pull request the changesets action keeps open
// (changeset-release/main, "Version packages"), and the Overview activity split between the design system and
// Bridge's own apps. Pure: no DOM, no fetch. Unit tested in release-view.test.ts.
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
      current = { name: pkg[1]!, version: pkg[2]!, bump: 'patch' };
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
    if (entry && current && bump) ids.add(entry[1]!.toLowerCase());
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

export interface ReleaseCard {
  /** "Next release: 14 changes, ready to publish." */
  title: string;
  /** Design system packages first, in plain words. */
  lines: string[];
  /** "And 6 Bridge tool updates: Bridge core, Figma plugin, ..." or null. Versions only for what teams install. */
  tools: string | null;
  breaking: boolean;
}

export function releaseCard(plan: ReleasePlan): ReleaseCard {
  const n = plan.changes;
  const ds = plan.packages.filter((p) => DS_PACKAGES.includes(p.name));
  const rest = plan.packages.filter((p) => !DS_PACKAGES.includes(p.name));
  const count = n ? `${n} merged ${n === 1 ? VOCAB.branch : VOCAB.branches}` : `${plan.packages.length} ${plan.packages.length === 1 ? 'package' : 'packages'}`;
  return {
    title: `Next release: ${count}, ready to publish.`,
    lines: ds.map(packageLine),
    tools: rest.length ? `${ds.length ? 'And ' : ''}${rest.length} Bridge tool ${rest.length === 1 ? 'update' : 'updates'}: ${rest.map((p) => packageWord(p.name)).join(', ')}.` : null,
    breaking: plan.packages.some((p) => p.bump === 'major'),
  };
}

/** Without a release pull request: what is live and how many changes wait (pending changesets on the main branch). */
export function waitingLine(current: string, pending: number): string {
  return `${current} is live. ${pending === 0 ? 'Nothing waits for the next release.' : `${pending} merged ${pending === 1 ? `${VOCAB.branch} waits` : `${VOCAB.branches} wait`} for the next release.`}`;
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
export function historySummary(e: SummaryEntry): string {
  if (e.bulk) return `Large token update, ${e.counts.total.toLocaleString('en-US')} token edits`;
  const fromChangeset = e.changesets?.map((c) => c.summary).find((s) => s && s.trim());
  const raw = fromChangeset ? firstSentence(fromChangeset) : (e.pr?.title ?? e.title);
  const clean = humanTitle(mdTitleText(raw).replace(/\s*\(#\d+\)\s*$/, '').trim());
  return clean.length > 90 ? `${clean.slice(0, 87).replace(/\s+\S*$/, '')}...` : clean;
}
