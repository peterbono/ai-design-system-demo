// Explorations: try experimental variables and components in a real product staging branch without touching main.
// An exploration is a branch named `explore/<slug>` with an open DRAFT pull request labeled `exploration`. It holds
// token edits and component work (requests filed with `exploration: explore/<slug>` are implemented there). Every
// exploration gets the per-branch previews (bridge.config.json previews.apps) and a snapshot of the packages a product
// staging branch installs (.github/workflows/preview-packages.yml). It is never merged as is: when the idea is
// validated it is promoted to a normal pull request for review, otherwise it is closed. The CI check "Exploration not
// merged as is" fails while the label is on, so an exploration cannot be merged by accident.
//
// Pure: branch naming, the draft pull request body, status and the promotion plan. Shared by Studio, the MCP server
// and the CLI, so an exploration reads the same everywhere. GitHub calls live in explorations-github.ts.

import type { BridgeConfig } from './config';
import { slugify } from './pr-composer';
import { previewLinks, readPreviewComment, type PreviewApps } from './previews';
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

export type ExplorationUseCase = 'user-test' | 'stakeholder-demo' | 'ab-idea' | 'terminal' | 'other';
export type ExplorationStatus = 'active' | 'promoted' | 'closed';
/** Where an exploration was started: Bridge Studio, the Figma plugin, the CLI or the MCP server (an AI agent). */
export type ExplorationSource = 'studio' | 'figma' | 'cli' | 'mcp';

export const EXPLORATION_USE_CASES: { value: ExplorationUseCase; label: string; hint: string }[] = [
  { value: 'user-test', label: 'Prototype for a user test', hint: 'A coded prototype on a product staging branch, with the real components and tokens.' },
  { value: 'stakeholder-demo', label: 'Stakeholder demo', hint: 'Show an idea on real screens before anyone commits to it.' },
  { value: 'ab-idea', label: 'A/B idea', hint: 'Ship a variant to a staging or experiment branch and compare it with what is live.' },
  { value: 'terminal', label: 'Exploring with Claude Code', hint: 'A designer works from the terminal with Claude and the Bridge MCP server on this branch, never on main.' },
  { value: 'other', label: 'Other', hint: 'Anything else worth trying before it becomes a change.' },
];

export const EXPLORATION_STATUS_LABEL: Record<ExplorationStatus, string> = { active: 'Running', promoted: 'Promoted to review', closed: 'Closed' };

export interface Exploration {
  /** Display name, sentence case: "Denser data tables". */
  name: string;
  /** What the team wants to learn, in one or two sentences. */
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

/** Problems with a new exploration, as sentences that say how to fix them. Empty when it can start. */
export function explorationProblems(e: Pick<Exploration, 'name' | 'purpose'> & { slug?: string | undefined }): string[] {
  const out: string[] = [];
  const name = e.name.trim();
  const slug = e.slug?.trim() || explorationSlug(name);
  if (!name) out.push('Name the exploration, for example "Denser data tables".');
  else if (name.length > 60) out.push('Keep the name under 60 characters: it becomes the branch name.');
  else if (slug.length < 2 || !SLUG_RE.test(slug)) out.push('Use letters or digits in the name: it becomes the branch explore/<name>.');
  if (!e.purpose.trim()) out.push('Say what you want to learn, in one sentence.');
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
    e.purpose.trim(),
    '',
    `- Branch: \`${EXPLORATION_PREFIX}${slug}\``,
    ...(uc ? [`- Use case: ${uc}`] : []),
    ...(e.startedAt ? [`- Started: ${e.startedAt.slice(0, 10)}${e.author ? ` by @${e.author}` : ''}`] : []),
    '',
    'This file marks the branch as an exploration. It is never merged as is: promoting the pull request to review removes it.',
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
}

/** Draft pull request title: "Exploration: denser data tables". */
export function explorationPrTitle(e: Pick<Exploration, 'name'>): string {
  const n = e.name.trim().replace(/\.$/, '');
  return `Exploration: ${n.charAt(0).toLowerCase()}${n.slice(1)}`;
}

/**
 * The draft pull request body: purpose, what is experimental, how a product staging branch installs it, the
 * previews, and how to promote or close it. Markdown for people plus one hidden JSON block for tools.
 */
export function explorationPrBody(e: Exploration, ctx: ExplorationPrContext): string {
  const slug = e.slug || explorationSlug(e.name);
  const branch = `${EXPLORATION_PREFIX}${slug}`;
  const uc = useCaseLabel(e.useCase);
  const experimental = (e.experimental ?? []).map((x) => x.trim()).filter(Boolean);
  const lines = [
    `## Exploration: ${e.name.trim()}`,
    '',
    `> Not mergeable as is. This draft pull request is a sandbox on \`${branch}\`: promote it to a normal review when the idea is validated, or close it.`,
    '',
    `**Purpose.** ${e.purpose.trim()}`,
    ...(uc ? ['', `**Use case.** ${uc}`] : []),
    '',
    '### What is experimental',
    '',
    ...(experimental.length ? experimental.map((x) => `- ${x}`) : ['- Token edits and component work committed to this branch. Nothing here reaches main or production.']),
    ...(ctx.requests?.length ? ['', 'Requests implemented here:', ...ctx.requests.map((r) => `- #${r.number} ${r.title}`)] : []),
    '',
    '### Try it in a product staging branch',
    '',
  ];
  // No guessed command here: pkg.pr.new may not be set up. The sticky comment has the one the workflow published.
  lines.push(
    'In the product repo, on a branch that deploys to staging (production keeps the released version), install the snapshot with the command in the "Try this exploration in your product" comment below. It appears a few minutes after each push and always matches the latest commit.',
  );
  lines.push('', '### Previews', '');
  const links = previewLinks(ctx.apps, { branch, ...(ctx.pr ? { pr: ctx.pr } : {}) });
  if (links.length) lines.push('| App | Preview |', '| --- | --- |', ...links.map((l) => `| ${l.label} | ${l.url} |`));
  else lines.push('Preview deploys are not set up: add `previews.apps` to `bridge.config.json` (docs/PREVIEWS.md).');
  lines.push(
    '',
    '### When it is done',
    '',
    `- **Promote:** in Bridge Studio (Changes, Explorations, Promote to review) or \`bridge explore promote ${slug}\`. Bridge marks the pull request ready for review, removes the \`${EXPLORATION_LABEL}\` label and the exploration note, and adds the tier labels. Then it goes through the usual review.`,
    '- **Close:** close this pull request. The branch stays for reference; the preview prerelease is removed.',
    '',
    `<!-- ${MARK} ${JSON.stringify({ name: e.name.trim(), purpose: e.purpose.trim(), slug, ...(e.useCase ? { useCase: e.useCase } : {}), ...(experimental.length ? { experimental } : {}), ...(e.author ? { author: e.author } : {}), ...(e.startedAt ? { startedAt: e.startedAt } : {}), ...(e.source ? { source: e.source } : {}), ...(e.agent ? { agent: e.agent } : {}) }).replace(/-->/g, '--\\u003e')} -->`,
  );
  return lines.join('\n');
}

/** The exploration inside a pull request body, or undefined when it has no valid Bridge block. */
export function parseExplorationBody(body: string | null | undefined): Exploration | undefined {
  if (!body) return undefined;
  const m = new RegExp(`<!-- ${MARK} (\\{[\\s\\S]*?\\}) -->`).exec(body);
  if (!m) return undefined;
  try {
    const e = JSON.parse(m[1]!) as Exploration;
    return e && typeof e.name === 'string' && typeof e.purpose === 'string' ? e : undefined;
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
}

const labelNames = (labels: ExplorationPullLike['labels']) => labels.map((l) => (typeof l === 'string' ? l : (l.name ?? '')));

/** True for a pull request that is or was an exploration: an `explore/*` branch, the label, or the Bridge block. */
export function isExplorationPull(p: ExplorationPullLike): boolean {
  return isExplorationBranch(p.headRef) || labelNames(p.labels).includes(EXPLORATION_LABEL) || Boolean(parseExplorationBody(p.body));
}

/**
 * Where an exploration stands: closed without merging = closed; open with the `exploration` label = active
 * (running); otherwise promoted (the label was removed, so it is a normal pull request now, open or merged).
 */
export function explorationStatus(p: ExplorationPullLike): ExplorationStatus {
  const merged = Boolean(p.merged || p.merged_at || p.state === 'merged');
  if (p.state !== 'open' && !merged) return 'closed';
  if (p.state === 'open' && labelNames(p.labels).includes(EXPLORATION_LABEL)) return 'active';
  return 'promoted';
}

/** True while the label is on: the pull request must not merge (the CI check fails, Studio blocks the merge). */
export const isActiveExploration = (labels: ExplorationPullLike['labels']) => labelNames(labels).includes(EXPLORATION_LABEL);

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
    `- Do not open a pull request to main and do not create another branch: the draft pull request of ${branch} is the place. It is promoted to review only when the idea is validated.`,
    '- Do not mark the pull request ready for review and do not remove the exploration label: promoting is a person\'s decision.',
  ];
}
