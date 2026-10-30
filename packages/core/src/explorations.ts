// Explorations: try experimental variables and components in a real product staging branch without touching main.
// An exploration is a branch named `explore/<slug>` with an open DRAFT pull request labeled `exploration`. It holds
// token edits and component work (requests filed with `exploration: explore/<slug>` are implemented there). Every
// exploration gets the per-branch previews (bridge.config.json previews.apps) and a snapshot of the packages a product
// staging branch installs (.github/workflows/preview-packages.yml). The CI check "Exploration not merged as is" fails
// while the label is on, so an exploration cannot be merged by accident.
//
// An exploration is a living prototype everyone keeps coming back to (decision 2026-10-30), so it is never closed:
// - "Done exploring" (doneExploringPlan) hands it to the developers: the `exploration` label goes, `ready-for-devs`
//   comes, the draft stays a draft and its preview link stays alive. The pieces the library lacks become requests for
//   the DS lead (prod-branch.ts pieceRequest). Developers continue on the branch from there, as a starting point: the
//   prototype code is never reviewed or tested as is. Their pushes read "Being built", the merge reads "Shipped".
// - "Archive" (the `archived` label) hides it from the default lists while the pull request, and so its preview, stay
//   open. Closing a pull request would delete its preview prerelease and visual images.
// The older "promote to review" path (promotionPlan) stays for tools that still call it.
//
// Pure: branch naming, the draft pull request body, status and the plans. Shared by Studio, the MCP server and the
// CLI, so an exploration reads the same everywhere. GitHub calls live in explorations-github.ts.

import type { BridgeConfig } from './config';
import { slugify } from './pr-composer';
import { previewLinks, previewUrl, readPreviewComment, type PreviewApps } from './previews';
import { classifyRisk, type ChangedFile, type RiskTier } from './risk';

/** Every exploration pull request carries this label while it is an exploration. */
export const EXPLORATION_LABEL = 'exploration';
/** Exploration branches start with it. */
export const EXPLORATION_PREFIX = 'explore/';
/** Where the note that starts an exploration branch lives. Promotion removes it, so main never gets it. */
export const EXPLORATION_NOTES_DIR = '.bridge/explorations';
/** What Studio shows instead of a risk tier while the pull request is an exploration. */
export const EXPLORATION_TIER_LABEL = 'Exploration (not mergeable)';
/** Name of the CI job that fails while the label is on. */
export const EXPLORATION_CHECK = 'Exploration not merged as is';
/** Done exploring: the exploration label gives way to this one. Developers take the branch from there. */
export const EXPLORATION_READY_LABEL = 'ready-for-devs';
/** An archived exploration: hidden from the default lists, its pull request and preview still open. */
export const EXPLORATION_ARCHIVED_LABEL = 'archived';

export type ExplorationUseCase = 'user-test' | 'stakeholder-demo' | 'ab-idea' | 'terminal' | 'other';
/**
 * active: running (the exploration label is on). ready: done exploring, waiting for developers to take it. building:
 * developers pushed to it (or marked it ready for review) since. shipped: merged after done exploring. promoted: sent
 * to review the older way (label removed without done exploring), open or merged. closed: closed without merging.
 */
export type ExplorationStatus = 'active' | 'ready' | 'building' | 'shipped' | 'promoted' | 'closed';
/** Where an exploration was started: Bridge Studio, the Figma plugin, the CLI or the MCP server (an AI agent). */
export type ExplorationSource = 'studio' | 'figma' | 'cli' | 'mcp';

export const EXPLORATION_USE_CASES: { value: ExplorationUseCase; label: string; hint: string }[] = [
  { value: 'user-test', label: 'Prototype for a user test', hint: 'A coded prototype in a test version of a product, with the real components and tokens.' },
  { value: 'stakeholder-demo', label: 'Stakeholder demo', hint: 'Show an idea on real screens before anyone signs off on it.' },
  { value: 'ab-idea', label: 'A/B idea', hint: 'Ship a variant to a test version of a product and compare it with what is live.' },
  { value: 'terminal', label: 'Exploring with Claude Code', hint: 'A designer works from the terminal with Claude and the Bridge MCP server inside this exploration, never in the library.' },
  { value: 'other', label: 'Other', hint: 'Anything else worth trying before it becomes a change.' },
];

export const EXPLORATION_STATUS_LABEL: Record<ExplorationStatus, string> = {
  active: 'Running',
  ready: 'Waiting for code',
  building: 'Being built',
  shipped: 'Shipped',
  promoted: 'Promoted to review',
  closed: 'Closed',
};

export interface Exploration {
  /** Display name, sentence case: "Denser data tables". */
  name: string;
  /**
   * What the team wants to learn, in one or two sentences, or empty: designers explore freely and nobody is asked
   * for a brief (Claude passes the designer's first sentence when it has one).
   */
  purpose: string;
  /** Branch slug: `explore/<slug>`. Derived from the name when missing. */
  slug?: string | undefined;
  useCase?: ExplorationUseCase | undefined;
  /** What is experimental, one line each: "color.action.primary.bg", "Button: pill radius". */
  experimental?: string[] | undefined;
  /** GitHub login of who started it, when known. */
  author?: string | undefined;
  /** ISO date it started. */
  startedAt?: string | undefined;
  /** Where it was started, so Studio says "You" only for what the viewer started there. */
  source?: ExplorationSource | undefined;
  /** The AI agent that started it ("claude"), when one did: the GitHub account alone cannot tell. */
  agent?: string | undefined;
  /** A Jira ticket key ("DS-42"), first in the pull request title so Jira's GitHub integration links it. */
  jira?: string | undefined;
  /** ISO date someone said "Done exploring". */
  doneAt?: string | undefined;
  /** The branch head at that moment: a newer head means developers are building on it. */
  doneSha?: string | undefined;
}

const MARK = 'bridge-exploration';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Denser data tables!" -> "denser-data-tables". Up to 40 characters, cut at a word boundary. Empty when nothing is left. */
export function explorationSlug(name: string): string {
  const s = name.trim().replace(/^explore\//i, '');
  if (!/[a-z0-9]/i.test(s)) return '';
  return slugify(s, 40);
}

/** `explore/<slug>` for a name, a slug or a branch name. */
export function explorationBranch(nameOrBranch: string): string {
  return `${EXPLORATION_PREFIX}${explorationSlug(nameOrBranch)}`;
}

/** True for `explore/<valid-slug>`. */
export function isExplorationBranch(ref: string | null | undefined): boolean {
  const r = (ref ?? '').replace(/^refs\/heads\//, '');
  return r.startsWith(EXPLORATION_PREFIX) && SLUG_RE.test(r.slice(EXPLORATION_PREFIX.length));
}

/** The slug of an exploration branch, or null. */
export function explorationSlugFromBranch(ref: string): string | null {
  return isExplorationBranch(ref) ? ref.replace(/^refs\/heads\//, '').slice(EXPLORATION_PREFIX.length) : null;
}

/** Path of the note that starts an exploration branch. */
export const explorationNotePath = (slug: string) => `${EXPLORATION_NOTES_DIR}/${slug}.md`;

/**
 * Problems with a new exploration, as sentences that say how to fix them. Empty when it can start. Only the name is
 * needed: the purpose is optional, nobody has to write a brief to explore.
 */
export function explorationProblems(e: Pick<Exploration, 'name'> & { purpose?: string | undefined; slug?: string | undefined }): string[] {
  const out: string[] = [];
  const name = e.name.trim();
  const slug = e.slug?.trim() || explorationSlug(name);
  if (!name) out.push('Name the exploration, for example "Denser data tables".');
  else if (name.length > 60) out.push('Keep the name under 60 characters: it becomes the exploration\'s link name.');
  else if (slug.length < 2 || !SLUG_RE.test(slug)) out.push('Use letters or digits in the name: it becomes the exploration\'s link name.');
  return out;
}

const useCaseLabel = (u: ExplorationUseCase | undefined) => EXPLORATION_USE_CASES.find((x) => x.value === u)?.label;

/** The note committed as the first commit of the branch (`.bridge/explorations/<slug>.md`). */
export function explorationNote(e: Exploration): string {
  const slug = e.slug || explorationSlug(e.name);
  const uc = useCaseLabel(e.useCase);
  return [
    `# Exploration: ${e.name.trim()}`,
    '',
    ...(e.purpose?.trim() ? [e.purpose.trim(), ''] : []),
    `- Branch: \`${EXPLORATION_PREFIX}${slug}\``,
    ...(uc ? [`- Use case: ${uc}`] : []),
    ...(e.startedAt ? [`- Started: ${e.startedAt.slice(0, 10)}${e.author ? ` by @${e.author}` : ''}`] : []),
    '',
    'This file marks the branch as an exploration. It is never merged as is: "Done exploring" removes it before developers take the branch.',
    '',
  ].join('\n');
}

export interface ExplorationPrContext {
  owner: string;
  repo: string;
  /** Unknown before the pull request exists: the install section then says where the command will appear. */
  pr?: number | undefined;
  packages: string[];
  apps: PreviewApps;
  /** Requests implemented on this exploration. */
  requests?: { number: number; title: string }[] | undefined;
  /**
   * Set when the exploration lives in a product's own repository (productRepoOf): the body says to check the branch
   * out there and to get the library from npm (`library`: the design system repository), with the product's preview
   * template instead of the library's apps.
   */
  inProduct?: { name: string; library: string; preview?: string | undefined } | undefined;
}

/** Draft pull request title: "Exploration: denser data tables". */
export function explorationPrTitle(e: Pick<Exploration, 'name'>): string {
  const n = e.name.trim().replace(/\.$/, '');
  return `Exploration: ${n.charAt(0).toLowerCase()}${n.slice(1)}`;
}

/**
 * The draft pull request body: purpose, what is experimental, how a product staging branch installs it, the
 * previews, and how it ends (Done exploring, Archive). Markdown for people plus one hidden JSON block for tools.
 */
export function explorationPrBody(e: Exploration, ctx: ExplorationPrContext): string {
  const slug = e.slug || explorationSlug(e.name);
  const branch = `${EXPLORATION_PREFIX}${slug}`;
  const uc = useCaseLabel(e.useCase);
  const experimental = (e.experimental ?? []).map((x) => x.trim()).filter(Boolean);
  const lines = [
    `## Exploration: ${e.name.trim()}`,
    '',
    `> Not mergeable as is. This draft pull request is a living prototype on \`${branch}\`: say "Done exploring" when the idea is ready for developers. Keep it open, so its preview link keeps working.`,
    '',
    ...(e.purpose?.trim() ? [`**Purpose.** ${e.purpose.trim()}`, ''] : []),
    ...(uc ? [`**Use case.** ${uc}`, ''] : []),
    '### What is experimental',
    '',
    ...(experimental.length
      ? experimental.map((x) => `- ${x}`)
      : [ctx.inProduct ? `- The ${ctx.inProduct.name} screens and flows built on this branch with the library. Nothing here reaches main or production.` : '- Token edits and component work committed to this branch. Nothing here reaches main or production.']),
    ...(ctx.requests?.length ? ['', 'Requests implemented here:', ...ctx.requests.map((r) => `- #${r.number} ${r.title}`)] : []),
    '',
  ];
  if (ctx.inProduct) {
    // In the product repository: developers check the branch out in their own environment, the library comes from npm.
    const p = ctx.inProduct;
    lines.push(
      '### Work on it',
      '',
      `This exploration lives in the ${p.name} repository, so it runs in your usual environment: \`git fetch origin && git switch ${branch}\`, then start ${p.name} as you always do.`,
      '',
      `The library comes from npm, as on main. To try library changes that are not released yet, install the snapshot of their branch in ${p.library} (\`npm i @bridge-ds/react@<snapshot>\`): the command is in its "Try this exploration in your product" comment. Library changes are made in ${p.library}, never on this branch.`,
      '',
      '### Previews',
      '',
    );
    const url = p.preview ? previewUrl(p.preview, { branch, ...(ctx.pr ? { pr: ctx.pr } : {}) }) : null;
    if (url) lines.push('| App | Preview |', '| --- | --- |', `| ${p.name} | ${url} |`);
    else lines.push(`The preview deploys of ${p.name}, if it has them, build this branch like any other.`);
  } else {
    // No guessed command here: pkg.pr.new may not be set up. The sticky comment has the one the workflow published.
    lines.push(
      '### Try it in a product staging branch',
      '',
      'In the product repo, on a branch that deploys to staging (production keeps the released version), install the snapshot with the command in the "Try this exploration in your product" comment below. It appears a few minutes after each push and always matches the latest commit.',
    );
    lines.push('', '### Previews', '');
    const links = previewLinks(ctx.apps, { branch, ...(ctx.pr ? { pr: ctx.pr } : {}) });
    if (links.length) lines.push('| App | Preview |', '| --- | --- |', ...links.map((l) => `| ${l.label} | ${l.url} |`));
    else lines.push('Preview deploys are not set up: add `previews.apps` to `bridge.config.json` (docs/PREVIEWS.md).');
  }
  lines.push(
    '',
    '### When it is done',
    '',
    `- **Done exploring:** on the exploration's page in Bridge Studio, or \`bridge explore done ${slug}\`. Bridge removes the \`${EXPLORATION_LABEL}\` label and the exploration note, adds \`${EXPLORATION_READY_LABEL}\`, and sends the pieces the designer picks to the DS lead as requests. Nothing is closed or merged: developers continue on \`${branch}\`.`,
    `- **Archive:** \`bridge explore archive ${slug}\` adds the \`${EXPLORATION_ARCHIVED_LABEL}\` label. Keep this pull request open: closing it removes the preview prerelease.`,
    '',
    explorationBlock({ ...e, slug }),
  );
  return lines.join('\n');
}

/** The hidden block tools read: the exploration as JSON. */
function explorationBlock(e: Exploration): string {
  const experimental = (e.experimental ?? []).map((x) => x.trim()).filter(Boolean);
  const data = {
    name: e.name.trim(),
    purpose: (e.purpose ?? '').trim(),
    slug: e.slug || explorationSlug(e.name),
    ...(e.useCase ? { useCase: e.useCase } : {}),
    ...(experimental.length ? { experimental } : {}),
    ...(e.author ? { author: e.author } : {}),
    ...(e.startedAt ? { startedAt: e.startedAt } : {}),
    ...(e.source ? { source: e.source } : {}),
    ...(e.agent ? { agent: e.agent } : {}),
    ...(e.doneAt ? { doneAt: e.doneAt } : {}),
    ...(e.doneSha ? { doneSha: e.doneSha } : {}),
  };
  return `<!-- ${MARK} ${JSON.stringify(data).replace(/-->/g, '--\\u003e')} -->`;
}

/** The exploration inside a pull request body, or undefined when it has no valid Bridge block. */
export function parseExplorationBody(body: string | null | undefined): Exploration | undefined {
  if (!body) return undefined;
  const m = new RegExp(`<!-- ${MARK} (\\{[\\s\\S]*?\\}) -->`).exec(body);
  if (!m) return undefined;
  try {
    const e = JSON.parse(m[1]!) as Exploration;
    if (!e || typeof e.name !== 'string') return undefined;
    // Started without a purpose: nothing was asked, the exploration reads with an empty one.
    return typeof e.purpose === 'string' ? e : e.purpose === undefined ? { ...e, purpose: '' } : undefined;
  } catch {
    return undefined;
  }
}

export interface ExplorationPullLike {
  state: string;
  merged?: boolean | undefined;
  merged_at?: string | null | undefined;
  labels: (string | { name?: string })[];
  headRef?: string | undefined;
  body?: string | null | undefined;
  /** Head commit and draft flag: after "Done exploring", a newer head or a ready pull request reads "Being built". */
  headSha?: string | undefined;
  draft?: boolean | undefined;
}

const labelNames = (labels: readonly (string | { name?: string })[]) => labels.map((l) => (typeof l === 'string' ? l : (l.name ?? '')));

/** True for a pull request that is or was an exploration: an `explore/*` branch, the label, or the Bridge block. */
export function isExplorationPull(p: ExplorationPullLike): boolean {
  return isExplorationBranch(p.headRef) || labelNames(p.labels).includes(EXPLORATION_LABEL) || Boolean(parseExplorationBody(p.body));
}

/** "Done exploring" was said: the `ready-for-devs` label, or the date in the exploration block. */
export function isHandedOff(p: Pick<ExplorationPullLike, 'labels' | 'body'>): boolean {
  return labelNames(p.labels).includes(EXPLORATION_READY_LABEL) || Boolean(parseExplorationBody(p.body)?.doneAt);
}

/**
 * Where an exploration stands: closed without merging = closed; open with the `exploration` label = active
 * (running). After "Done exploring": merged = shipped; marked ready for review, or a head newer than the one done
 * exploring left = building (developers work on it); otherwise ready (waiting for code). The label removed without
 * done exploring is the older promotion: promoted, open or merged.
 */
export function explorationStatus(p: ExplorationPullLike): ExplorationStatus {
  const merged = Boolean(p.merged || p.merged_at || p.state === 'merged');
  if (p.state !== 'open' && !merged) return 'closed';
  if (p.state === 'open' && labelNames(p.labels).includes(EXPLORATION_LABEL)) return 'active';
  if (!isHandedOff(p)) return 'promoted';
  if (merged) return 'shipped';
  if (p.draft === false) return 'building';
  const doneSha = parseExplorationBody(p.body)?.doneSha;
  if (doneSha && p.headSha && p.headSha !== doneSha) return 'building';
  return 'ready';
}

/** True while the label is on: the pull request must not merge (the CI check fails, Studio blocks the merge). */
export const isActiveExploration = (labels: ExplorationPullLike['labels']) => labelNames(labels).includes(EXPLORATION_LABEL);

/** True for an archived exploration: hidden from the default lists, reachable from the Archived filter. */
export const isArchivedExploration = (labels: readonly (string | { name?: string })[] | null | undefined) => labelNames(labels ?? []).includes(EXPLORATION_ARCHIVED_LABEL);

/**
 * Open explorations that stay out of the review queue: running, archived, or handed to developers while still a
 * draft. Once developers mark it ready for review it is a change like any other.
 */
export function isHeldExploration(p: { state?: string | undefined; draft?: boolean | undefined; labels?: readonly (string | { name?: string })[] | null | undefined }): boolean {
  if (p.state !== undefined && p.state !== 'open') return false;
  const names = labelNames(p.labels ?? []);
  if (names.includes(EXPLORATION_LABEL) || names.includes(EXPLORATION_ARCHIVED_LABEL)) return true;
  return names.includes(EXPLORATION_READY_LABEL) && p.draft !== false;
}

// ---------------------------------------------------------------------------------------------------------------
// Done exploring

/** How a developer takes an exploration: fetch, then check out its branch. */
export const explorationTakeCommands = (branch: string): [string, string] => ['git fetch origin', `git checkout ${branch}`];

/** What developers read next to those commands: a starting point, never code ready to ship. */
export const EXPLORATION_STARTING_POINT =
  "A starting point, not ready to ship: Claude's prototype code is not reviewed or tested. Continue on this branch: its pull request already exists, so Bridge follows your pushes, and the merge reads as shipped.";

export interface DoneExploringPlan {
  /** Labels to remove (the exploration label) and to add (ready-for-devs). */
  removeLabels: string[];
  addLabels: string[];
  /** Files to delete on the branch first: the exploration note, so main never gets it. */
  removeFiles: string[];
  /** The body once done: the developer section in place of the sandbox note and the "When it is done" part. */
  body: string;
  /** The two commands a developer runs to take it. */
  take: [string, string];
  /** Done exploring never merges, closes or marks the draft ready. */
  markReady: false;
}

/**
 * What "Done exploring" does to the pull request: the exploration label gives way to `ready-for-devs` (the merge
 * guard stops failing, so developers can ship it once the code is theirs), the exploration note leaves the branch, and
 * the body says how developers take it. The draft stays a draft and the pull request stays open, so its preview lives
 * on. The caller records the head once the note is gone (withDoneExploring with `doneSha`).
 */
export function doneExploringPlan(input: { body: string | null | undefined; branch: string; files: { path: string; status?: string | undefined }[]; date?: Date | undefined }): DoneExploringPlan {
  const removeFiles = input.files.filter((f) => f.path.startsWith(`${EXPLORATION_NOTES_DIR}/`) && f.status !== 'removed').map((f) => f.path);
  return {
    removeLabels: [EXPLORATION_LABEL],
    addLabels: [EXPLORATION_READY_LABEL],
    removeFiles,
    body: withDoneExploring(input.body, { branch: input.branch, doneAt: (input.date ?? new Date()).toISOString() }),
    take: explorationTakeCommands(input.branch),
    markReady: false,
  };
}

const DEV_SECTION = '### For developers';

/**
 * The body after "Done exploring": the sandbox warning and the "When it is done" part give way to the developer
 * section (the two commands and the starting point note), and the hidden block records when, and on which head once
 * known. Calling it again replaces the section and the block.
 */
export function withDoneExploring(body: string | null | undefined, done: { branch: string; doneAt: string; doneSha?: string | undefined }): string {
  const e = parseExplorationBody(body);
  const [fetch, checkout] = explorationTakeCommands(done.branch);
  const section = [
    DEV_SECTION,
    '',
    `**Done exploring on ${done.doneAt.slice(0, 10)}.** ${EXPLORATION_STARTING_POINT}`,
    '',
    '```sh',
    fetch,
    checkout,
    '```',
    '',
    'Mark this pull request ready for review when the code is yours. Keep it open: its preview link is how designers, the DS lead and stakeholders come back to the prototype.',
  ].join('\n');
  const block = new RegExp(`<!-- ${MARK} \\{[\\s\\S]*?\\} -->`);
  const kept = (body ?? '')
    .replace(/^> Not mergeable as is\..*$\n?\n?/m, '')
    .replace(/### When it is done[\s\S]*?(?=<!-- |$)/, '')
    .replace(/### For developers[\s\S]*?(?=### |<!-- |$)/, '');
  if (!e || !block.test(kept)) return `${kept.trim()}${kept.trim() ? '\n\n' : ''}${section}`;
  const at = kept.search(block);
  const nextBlock = explorationBlock({ ...e, doneAt: done.doneAt, ...(done.doneSha ? { doneSha: done.doneSha } : {}) });
  const after = kept.slice(at).replace(block, () => nextBlock).trim();
  return `${kept.slice(0, at).trim()}\n\n${section}\n\n${after}`.trim();
}

export interface PromotionPlan {
  tier: RiskTier;
  reasons: string[];
  /** Labels to remove (the exploration label). */
  removeLabels: string[];
  /** Tier labels from the shared classifier. */
  addLabels: string[];
  /** Files to delete on the branch before review: the exploration note. */
  removeFiles: string[];
  /** The pull request body for review. */
  body: string;
  /** Title without the "Exploration:" prefix. */
  title: string;
  markReady: true;
}

/**
 * What promoting an exploration does: the tier from the files it changes (the shared classifier, the exploration
 * note left out since promotion deletes it), tier labels, the exploration label removed, a review body that keeps
 * the purpose and closes the requests implemented on it, and the draft marked ready for review.
 */
export function promotionPlan(input: {
  title: string;
  body: string | null | undefined;
  labels: ExplorationPullLike['labels'];
  files: ChangedFile[];
  config?: BridgeConfig | undefined;
  /** Request issues implemented on this exploration: the review body closes them. */
  requests?: number[] | undefined;
  date?: Date | undefined;
}): PromotionPlan {
  const exploration = parseExplorationBody(input.body);
  // A Jira key first in the title ("DS-42 Exploration: pill buttons") stays first after promotion.
  const jira = /^([A-Z][A-Z0-9_]*-\d+)\s+/.exec(input.title)?.[1] ?? null;
  const title = jira ? input.title.slice(jira.length).trim() : input.title;
  const removeFiles = input.files.filter((f) => f.path.startsWith(`${EXPLORATION_NOTES_DIR}/`) && f.status !== 'removed').map((f) => f.path);
  const files = input.files.filter((f) => !f.path.startsWith(`${EXPLORATION_NOTES_DIR}/`));
  const risk = classifyRisk({ files, ...(input.config ? { config: input.config } : {}) });
  const tokens = files.some((f) => f.path.endsWith('.tokens.json'));
  const addLabels = [`tier: ${risk.tier}`, ...(risk.tier === 3 && tokens ? ['tokens'] : [])];
  const date = (input.date ?? new Date()).toISOString().slice(0, 10);
  const existing = new Set(input.body ? [...input.body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map((m) => Number(m[1])) : []);
  const closes = [...new Set(input.requests ?? [])].filter((n) => !existing.has(n));
  const kept = (input.body ?? '')
    // The sandbox warning and the promote/close instructions no longer apply.
    .replace(/^> Not mergeable as is\..*$\n?\n?/m, '')
    .replace(/### When it is done[\s\S]*?(?=<!-- |$)/, '')
    .replace(/^## Exploration: /m, '## ')
    .trim();
  const body = [
    `**Promoted from an exploration on ${date}.** Review it like any change: the tier below comes from the files it touches.`,
    '',
    kept || `## ${title.replace(/^Exploration:\s*/i, '')}`,
    '',
    `**Risk tier:** ${risk.tier}.`,
    ...risk.reasons.slice(0, 8).map((r) => `- ${r}`),
    ...(closes.length ? ['', ...closes.map((n) => `Closes #${n}`)] : []),
  ].join('\n');
  const t = title.replace(/^Exploration:\s*/i, '').trim() || exploration?.name || title;
  return {
    tier: risk.tier,
    reasons: risk.reasons,
    removeLabels: [EXPLORATION_LABEL],
    addLabels,
    removeFiles,
    body,
    title: `${jira ? `${jira} ` : ''}${t.charAt(0).toUpperCase()}${t.slice(1)}`,
    markReady: true,
  };
}

/** Where the test build of an exploration stands, from its sticky preview comment and the branch head. */
export type ExplorationTryIt =
  | { state: 'ready'; command: string; source: 'pkg.pr.new' | 'release' | 'other'; sha7: string | null }
  | { state: 'building' }
  | { state: 'failed' };

/**
 * The install command a product staging branch can trust, read from the `<!-- bridge-branch-preview -->` comment,
 * never guessed: no comment yet, or a comment about an older commit than the head, means the snapshot is still
 * building; a comment without a command means the publish failed.
 */
export function explorationTryIt(input: { comment?: string | null | undefined; headSha?: string | null | undefined }): ExplorationTryIt {
  const c = readPreviewComment(input.comment);
  if (!c) return { state: 'building' };
  if (input.headSha && c.sha7 && !input.headSha.startsWith(c.sha7)) return { state: 'building' };
  if (!c.command || c.source === 'none') return { state: 'failed' };
  return { state: 'ready', command: c.command, source: c.source, sha7: c.sha7 };
}

/**
 * The message a designer sends a developer: what the exploration is, the install command for a product staging
 * branch, the previews and the pull request. Plain text, one paragraph, ready to paste in a chat.
 */
export function explorationShareMessage(input: { name: string; branch: string; url: string; command?: string | null | undefined; previews?: { label: string; url: string }[] | undefined; local?: string | undefined }): string {
  const name = input.name.trim().replace(/"/g, "'");
  const head = input.command
    ? `Exploration "${name}" (${input.branch}): try it in a staging branch of your product with: ${input.command}.`
    : `Exploration "${name}" (${input.branch}): its test build is being prepared, the install command for a staging branch of your product will be on the pull request in a few minutes.`;
  const previews = (input.previews ?? []).map((p) => `${p.label} ${p.url}`);
  // No online preview (explorations are not deployed): how to open it on a developer's machine.
  const local = !previews.length && input.local ? `Try it locally: ${input.local}, then start Storybook or the app with its dev command.` : '';
  return [head, previews.length ? `Previews: ${previews.join(', ')}.` : local, `Pull request: ${input.url}.`].filter(Boolean).join(' ');
}

/**
 * The rules Claude follows on an exploration branch (request briefs, docs drafts, token edits with a target branch):
 * work there, never on main, and never open a pull request to main: the exploration's draft pull request is the place.
 */
export function explorationRules(branch: string): string[] {
  return [
    `- Work on the existing branch ${branch} (git fetch origin && git switch ${branch}). Commit there.`,
    `- Do not open a pull request to main and do not create another branch: the draft pull request of ${branch} is the place. It stays open as a living prototype.`,
    '- Do not mark the pull request ready for review, do not remove the exploration label and never close it: "Done exploring" is a person\'s decision, and closing removes its preview.',
  ];
}
