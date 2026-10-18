// What kind of work a change, an exploration or a request is, and who made it. Pure: no DOM, no fetch. Unit tested
// in work-nature.test.ts.
//
// Studio is for designers. Work that only touches code (a Select usable on pages without React, build or test
// tooling, types) is developer work: designers do not decide on it, so it leaves the designer surfaces (Needs you,
// the board, the Changes badge) and stays findable, tagged "Developer", in the Changes lists.
//
// Nature, from real signals only, first match wins:
//   1. A label says it: "developer", "tech", "dev-only", "tooling" (developer) or "design" (design).
//   2. Usage guidance: design.
//   3. The visual impact run shows a difference: design, whatever else it touches.
//   4. The title speaks code ("React", "npm", "TypeScript", "props"...): developer. Titles stay as written.
//   5. The changed files: tokens or usage guidance are design; component styles and markup are design until the
//      visual impact run says nothing changes on screen; tests, examples, types, build and tooling only are developer.
//   6. The visual impact run says nothing changes on screen: developer.
//   7. The request kind: a new component, a new variant, a new look or a token binding is design.
//   8. Nothing known: design, said as such (known: false), so nothing a designer should see is ever hidden.
//
// Who: every change in a repo may be opened under one GitHub account, people and AI agents alike, so the login alone
// never says "You". Agent markers: the pull request template box "AI agent (Claude)" ticked, "Author: AI agent", the
// "Generated with Claude Code" footer or a Claude Code session link in the body, a "Co-Authored-By: Claude" commit
// trailer, an agent label, an exploration started by an agent or from the MCP server, a request sent from Claude
// (MCP). "You" only for what the viewer started from Studio with no agent marker.
import type { ExplorationSource, RequestKind, RequestSource } from '@bridge-ds/core';

export type WorkNature = 'design' | 'developer';

export interface NatureResult {
  nature: WorkNature;
  /** Why, in plain words, for the report and the tag tooltip: "the title speaks code (React)". */
  reason: string;
  /** False when no signal decided and design is the default. */
  known: boolean;
}

/** What the changed files say, kept small so a status can carry it (scripts/pr-status). */
export interface FileSignals {
  /** Token sources (packages/tokens/src). */
  tokens: boolean;
  /** Usage guidance: component docs.json or the design language. */
  guidance: boolean;
  /** Component styles or markup, or a product screen: what the visual impact run captures. */
  visual: boolean;
  /** At least one file that only matters to developers: tests, examples, types, build, tooling, framework adapters. */
  developer: boolean;
  /** Every file is developer only (bookkeeping files aside: release notes, exploration notes, review drafts). */
  developerOnly: boolean;
}

/** Visual impact of the latest version: a difference, no difference, or not run yet (null: unknown). */
export type VisualSignal = 'changes' | 'no-change' | 'pending' | null;

export interface NatureSignals {
  title?: string | null;
  labels?: ({ name?: string } | string)[] | null;
  /** The changed files, or what they say (fileSignals). Null or absent: not read. */
  files?: string[] | FileSignals | null;
  visual?: VisualSignal;
  requestKind?: RequestKind | string | null;
  /** Only usage guidance (opened from the Library editor, or docs files only). */
  guidance?: boolean;
}

const labelName = (l: { name?: string } | string) => (typeof l === 'string' ? l : (l.name ?? '')).trim().toLowerCase();

const DEV_LABELS = /^(?:(?:type|kind|area|request):\s*)?(?:developer|dev|dev-only|developer-only|tech|technical|tooling|infra|build|ci|dependencies|deps)$/;
const DESIGN_LABELS = /^(?:(?:type|kind|area):\s*)?design$/;

/** Words that only developers use: when one names the work, the work is code. Whole words, any case. */
const JARGON: [RegExp, string][] = [
  [/\breact\b/i, 'React'],
  [/\bjsx\b/i, 'JSX'],
  [/\bnpm\b|\bpnpm\b|\byarn\b/i, 'npm'],
  [/\bcli\b/i, 'CLI'],
  [/\bmcp\b/i, 'MCP'],
  [/\btypescript\b/i, 'TypeScript'],
  [/\bprops?\b/i, 'props'],
  [/\bhydrat\w*/i, 'hydration'],
  [/\bssr\b|\bserver[- ]side render/i, 'server rendering'],
  [/\besm\b|\bcommonjs\b|\bcjs\b/i, 'modules'],
  [/\bwebpack\b|\bvite\b|\bbundler?\b|\bbundle size\b/i, 'bundling'],
  [/\beslint\b|\bstylelint\b|\blint(?:ing|er)?\b/i, 'lint'],
  [/\bvitest\b|\bjest\b|\bunit tests?\b/i, 'tests'],
  [/\bnode\.?js\b/i, 'Node.js'],
  [/\bweb components?\b/i, 'web components'],
  [/\bsdk\b|\bapi\b/i, 'API'],
  [/\bdependenc(?:y|ies)\b|\brefactor\w*/i, 'code upkeep'],
];

/** The first developer word in a title ("React"), or null. */
export function devJargon(title: string | null | undefined): string | null {
  if (!title) return null;
  for (const [re, word] of JARGON) if (re.test(title)) return word;
  return null;
}

const TOKEN_FILE = /^packages\/tokens\/src\//;
const GUIDANCE_FILE = /(^|\/)[A-Z]\w*\.docs\.json$|^docs\/DESIGN-LANGUAGE\.md$/;
/** Bookkeeping: says nothing about the nature (release notes, exploration notes, review drafts). */
const NEUTRAL_FILE = /^\.changeset\/|^\.bridge\/explorations\/|^docs\/pr-drafts\//;
const DEV_FILE = [
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)__(?:tests|mocks)__\//,
  /\.stories\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
  /(^|\/)types?\.ts$/,
  /(^|\/)(?:package(?:-lock)?\.json|tsconfig[\w.-]*\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /(^|\/)[\w.-]*\.config\.[cm]?[jt]s$/,
  /^\.github\/|^\.storybook\/|^scripts\/|^\.husky\//,
  /(^|\/)(?:\.eslintrc[\w.]*|\.stylelintrc[\w.]*|\.prettierrc[\w.]*|\.npmrc|\.nvmrc|vercel\.json)$/,
  /^packages\/(?:cli|mcp|core|eslint-plugin|stylelint-plugin|visual)\//,
  /^packages\/tokens\/(?:build\.mjs|scripts\/)/,
  /(^|\/)(?:adapters?|ssr|server)\//,
];
const VISUAL_FILE = [/^packages\/react\/src\/.*\.(?:css|tsx)$/, /^apps\/admin\/src\//];

/** What a list of changed files says about the nature of the work. */
export function fileSignals(files: string[]): FileSignals {
  const real = files.filter((f) => !NEUTRAL_FILE.test(f));
  const isDev = (f: string) => DEV_FILE.some((r) => r.test(f));
  const tokens = real.some((f) => TOKEN_FILE.test(f) && !isDev(f));
  const guidance = real.some((f) => GUIDANCE_FILE.test(f));
  const visual = real.some((f) => !isDev(f) && VISUAL_FILE.some((r) => r.test(f)));
  const developer = real.some(isDev);
  return { tokens, guidance, visual, developer, developerOnly: real.length > 0 && real.every(isDev) };
}

const DESIGN_KINDS = new Set(['new-component', 'new-variant', 'visual', 'token-binding', 'look']);
const DEV_KINDS = new Set(['tech', 'developer', 'tooling']);

const design = (reason: string, known = true): NatureResult => ({ nature: 'design', reason, known });
const developer = (reason: string): NatureResult => ({ nature: 'developer', reason, known: true });

/** The nature of a piece of work, from the signals that exist (see the rules at the top of this file). */
export function workNature(s: NatureSignals): NatureResult {
  const labels = (s.labels ?? []).map(labelName);
  const devLabel = labels.find((l) => DEV_LABELS.test(l));
  if (devLabel) return developer(`labelled "${devLabel}"`);
  if (labels.some((l) => DESIGN_LABELS.test(l))) return design('labelled "design"');
  if (s.guidance) return design('it changes usage guidance');
  if (s.visual === 'changes') return design('the visual impact run shows a difference on screen');
  const word = devJargon(s.title);
  if (word) return developer(`the title speaks code (${word})`);
  const f = s.files ? (Array.isArray(s.files) ? fileSignals(s.files) : s.files) : null;
  if (f) {
    if (f.tokens) return design('it changes tokens');
    if (f.guidance) return design('it changes usage guidance');
    if (f.visual) return s.visual === 'no-change' ? developer('it changes component code but the visual impact run shows no difference') : design('it changes how components look');
    if (f.developerOnly) return developer('it only touches tests, examples, types, build or tooling');
  }
  if (s.visual === 'no-change') return developer('the visual impact run shows no difference');
  const kind = s.requestKind ?? null;
  if (kind && DEV_KINDS.has(kind)) return developer(`the request is a ${kind} request`);
  if (kind && DESIGN_KINDS.has(kind)) return design(`the request asks for a ${kind.replace(/-/g, ' ')}`);
  return design('nothing says it is code only, so designers see it', false);
}

// ---------------------------------------------------------------------------------------------------------------
// Who made it

export interface AuthorSignals {
  /** Pull request, exploration or request body. */
  body?: string | null;
  /** Commit messages of the change, when read. */
  commits?: string[] | null;
  labels?: ({ name?: string } | string)[] | null;
  /** From the exploration block. */
  source?: ExplorationSource | null;
  agent?: string | null;
  /** The request the work answers was sent from Claude (MCP). */
  requestSource?: RequestSource | null;
}

const BODY_MARKERS = [
  /-\s*\[[xX]\]\s*AI agent/,
  /\*\*Author:\*\*\s*AI agent/i,
  /\bagent-authored\b/i,
  /Generated with \[?Claude Code\]?/i,
  /claude\.ai\/code\/session_/,
];
const AGENT_LABELS = /^(?:agent|ai-agent|ai agent|agent-authored|claude|by claude|source:\s*mcp)$/;
const TRAILER = /^co-authored-by:\s*claude\b/im;

/** True when a real marker says an AI agent made the work, whatever GitHub account opened it. */
export function agentMade(s: AuthorSignals): boolean {
  if (s.agent) return true;
  if (s.source === 'mcp' || s.requestSource === 'mcp') return true;
  if ((s.labels ?? []).some((l) => AGENT_LABELS.test(labelName(l)))) return true;
  if (s.body && BODY_MARKERS.some((r) => r.test(s.body!))) return true;
  return (s.commits ?? []).some((m) => TRAILER.test(m));
}

/** Who the board names on a piece of work. */
export type Maker = { kind: 'claude' } | { kind: 'you' } | { kind: 'person'; login: string } | { kind: 'account'; where: ExplorationSource | null };

const norm = (x: string) => x.trim().toLowerCase().replace(/^@/, '');

/**
 * Who made it, for the viewer: Claude when a marker says so; "you" only when the viewer started it from Studio; a
 * teammate by login; else the viewer's own account used outside Studio (the command line, Figma, or unknown).
 */
export function makerOf(input: AuthorSignals & { author: string | null; viewer: string | null }): Maker {
  if (agentMade(input)) return { kind: 'claude' };
  const mine = Boolean(input.viewer && input.author && norm(input.author) === norm(input.viewer));
  if (!mine) return input.author ? { kind: 'person', login: input.author } : { kind: 'account', where: input.source ?? null };
  return input.source === 'studio' ? { kind: 'you' } : { kind: 'account', where: input.source ?? null };
}

const WHERE: Record<ExplorationSource, string> = { studio: 'from Studio', figma: 'from Figma', cli: 'from the command line', mcp: 'by an AI agent' };

/** The first sentence of an exploration card: who is trying it. */
export function explorationMakerLine(m: Maker): string {
  switch (m.kind) {
    case 'claude':
      return 'Claude is building it.';
    case 'you':
      return 'You are trying it.';
    case 'person':
      return `@${m.login.replace(/^@/, '')} is trying it.`;
    case 'account':
      return m.where && m.where !== 'studio' ? `Started ${WHERE[m.where]} with your GitHub account.` : 'Started with your GitHub account.';
  }
}

/** A request an exploration implements, as far as its nature and its origin go. */
export interface LinkedRequestSignals {
  kind?: RequestKind | string | null;
  source?: RequestSource | null;
  labels?: ({ name?: string } | string)[] | null;
}

export interface ExplorationSignals {
  name: string;
  author: string | null;
  body?: string | null;
  labels?: ({ name?: string } | string)[] | null;
  /** From the exploration block (packages/core Exploration). */
  source?: ExplorationSource | null;
  agent?: string | null;
  commits?: string[] | null;
  requests?: LinkedRequestSignals[];
}

/**
 * The nature and the maker of an exploration. Its requests lend their kind, and their origin when it was a tool
 * (the CLI or the MCP server): an exploration started for a request sent from the command line was not started in
 * Studio either.
 */
export function explorationWork(x: ExplorationSignals, viewer: string | null): { nature: NatureResult; maker: Maker } {
  const reqs = x.requests ?? [];
  const nature = workNature({ title: x.name, labels: [...(x.labels ?? []), ...reqs.flatMap((r) => r.labels ?? [])], requestKind: reqs.find((r) => r.kind)?.kind ?? null });
  const toolSource = reqs.map((r) => r.source).find((s): s is 'cli' | 'mcp' => s === 'cli' || s === 'mcp') ?? null;
  const maker = makerOf({
    author: x.author,
    viewer,
    body: x.body ?? null,
    labels: x.labels ?? null,
    commits: x.commits ?? null,
    source: x.source ?? toolSource,
    agent: x.agent ?? null,
    requestSource: toolSource,
  });
  return { nature, maker };
}

// ---------------------------------------------------------------------------------------------------------------
// Developer work, off the designer surfaces

/** "Developer work, 1 in progress": the quiet line under the board that opens the list. Empty with none. */
export function devWorkLine(n: number): string {
  return n ? `Developer work, ${n} in progress` : '';
}

/** Changes list filter: everything (default), design only, developer only. */
export type WorkFilter = 'all' | 'design' | 'developer';

export const WORK_FILTERS: { value: WorkFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'design', label: 'Design' },
  { value: 'developer', label: 'Developer' },
];

/** Whether a row shows under a filter. */
export const showsUnder = (filter: WorkFilter, nature: WorkNature) => filter === 'all' || filter === nature;

/** The filter from the address (?work=developer), All by default. */
export function workFilterParam(search: string): WorkFilter {
  const v = new URLSearchParams(search).get('work');
  return v === 'design' || v === 'developer' ? v : 'all';
}
