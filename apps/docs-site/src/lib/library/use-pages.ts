// The Use pages of a Library (Install, Agents, How review works, Changelog), for any design system: what the shared
// views (components/ds/library/views/InstallView, AgentsView, ReviewView, ChangelogView) show. Pure and browser-safe:
// Markdown comes in as text (Bridge's own files at build time, a team's read from its repository in the browser).
import { releaseAnnouncement, type ChangelogReleaseRow, type RepoModel } from '@bridge-ds/core';
import { bullets, section, table } from '../markdown';

// --- How review works ------------------------------------------------------------------------------------------------

export type RuleHeading = 'Always' | 'Ask before' | 'Never';
export type PlainRules = Partial<Record<RuleHeading, { match: string; plain: string }[]>>;

export interface AgentRule {
  /** As written in the guidelines (inline Markdown). */
  original: string;
  /** In plain words when a rewrite still matches (agent-rules-plain.json), else the original. */
  plain: string;
  rewritten: boolean;
}

export interface MdTable {
  head: string[];
  /** Cells as inline Markdown. */
  rows: string[][];
}

/** The Risk tiers table of a governance document (docs/GOVERNANCE.md), null without one. */
export const riskTiersOf = (md: string): MdTable | null => table(section(md, 'Risk tiers'));

/** The "Who approves what" table of a governance document, null without one. */
export const approvalsOf = (md: string): MdTable | null => table(section(md, 'Who approves what'));

/** The numbered Review gates of a governance document (a wrapped item joins its continuation lines). */
export function reviewGatesOf(md: string): string[] {
  return section(md, 'Review gates')
    .filter((l) => /^\d+\.\s/.test(l) || /^\s{2,}\S/.test(l))
    .reduce<string[]>((acc, l) => {
      if (/^\d+\.\s/.test(l)) acc.push(l.replace(/^\d+\.\s+/, ''));
      else if (acc.length) acc[acc.length - 1] += ' ' + l.trim();
      return acc;
    }, []);
}

/** What a reviewer checks on a pull request an AI agent wrote. */
export const agentPrChecksOf = (md: string): string[] => bullets(section(md, 'Reviewing an AI-authored PR'));

/**
 * Always / Ask before / Never rules of an agent guidelines file (AGENTS.md). A rule reads in plain words when `plain`
 * has a rewrite whose `match` text still appears in it; otherwise its original wording shows, never stale prose.
 */
export function agentRulesOf(md: string, plain: PlainRules = {}): { heading: RuleHeading; rules: AgentRule[] }[] {
  return (['Always', 'Ask before', 'Never'] as const)
    .map((heading) => {
      const rules: AgentRule[] = bullets(section(md, heading)).map((original) => {
        const hit = plain[heading]?.find((p) => original.includes(p.match));
        return { original, plain: hit?.plain ?? original, rewritten: Boolean(hit) };
      });
      return { heading, rules };
    })
    .filter((g) => g.rules.length > 0);
}

const people = (list: readonly string[]) => (list.length ? list.map((p) => `\`${p.startsWith('@') ? p : `@${p}`}\``).join(', ') : 'Any two people with write access');

/**
 * Who approves, from bridge.config.json governance (owners and rights), as a table: what a team without a "Who
 * approves what" section in its governance document still says in its config.
 */
export function configApprovals(model: Pick<RepoModel, 'config'>): MdTable {
  const g = model.config.governance;
  const owners = { design: g?.owners?.design ?? [], tech: g?.owners?.tech ?? [] };
  const rights = g?.rights;
  const who = (right: 'approveDesign' | 'approveTech' | 'ship', fallback: string) => {
    const groups = rights?.[right];
    if (!groups?.length) return fallback;
    return groups.map((grp) => (grp === 'design' || grp === 'tech' ? `${grp === 'design' ? 'Design' : 'Tech'} owners` : String(grp))).join(', ');
  };
  return {
    head: ['Role', 'People', 'Approves'],
    rows: [
      ['Design owners', people(owners.design), `Design: ${who('approveDesign', 'design owners')}`],
      ['Tech owners', people(owners.tech), `Tech: ${who('approveTech', 'tech owners')}`],
      ['Ship', who('ship', 'Anyone with write access'), 'Merges an approved change'],
    ],
  };
}

/** Review gates from bridge.config.json governance, for a team without a governance document. */
export function configGates(model: Pick<RepoModel, 'config'>): string[] {
  const g = model.config.governance;
  const branches = [...new Set([model.config.repo?.defaultBranch ?? 'main', ...(g?.protectedBranches ?? [])])];
  const out = [`No Bridge surface writes to ${branches.map((b) => `\`${b}\``).join(', ')}: every change is a branch and a pull request.`];
  if (g?.guardrails?.length) out.push(`A change to ${g.guardrails.map((f) => `\`${f}\``).join(', ')} is Tier 3 on its own.`);
  if (g?.branchPrefix) out.push(`Agents propose changes on \`${g.branchPrefix}*\` branches${g.labels?.length ? `, labeled ${g.labels.map((l) => `\`${l}\``).join(', ')}` : ''}.`);
  return out;
}

// --- Agents ----------------------------------------------------------------------------------------------------------

/** What an llms.txt holds, counted from the text itself. A count its sections do not give (another layout) stays out. */
export function llmsStats(text: string): { value: number; label: string }[] {
  const lines = text.split('\n');
  const sectionOf = (title: string) => {
    const start = lines.findIndex((l) => l === `## ${title}`);
    if (start < 0) return [];
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    return lines.slice(start + 1, end < 0 ? undefined : end);
  };
  return [
    { value: lines.length, label: 'lines' },
    { value: sectionOf('Rules for agents (from AGENTS.md)').filter((l) => l.startsWith('- ')).length, label: 'agent rules' },
    { value: sectionOf('Semantic tokens').filter((l) => l.startsWith('- `var(')).length, label: 'semantic tokens' },
    { value: sectionOf('Components').filter((l) => l.startsWith('### ')).length, label: 'components' },
    { value: Math.round(new TextEncoder().encode(text).length / 1024), label: 'KB of plain text' },
  ].filter((s, i) => i === 0 || s.value > 0);
}

// --- Install ---------------------------------------------------------------------------------------------------------

export interface UsePackage {
  name: string;
  version: string;
  /** What it is for, one sentence, when the Library knows. */
  use?: string | undefined;
}

/** The packages a product installs: the components and the tokens when they can be told apart, else every one. */
export function installPackages(packages: readonly UsePackage[]): UsePackage[] {
  const ui = packages.filter((p) => /(^|[/-])(react|components|ui)$/.test(p.name));
  const tokens = packages.filter((p) => /(^|[/-])tokens$/.test(p.name));
  return ui.length || tokens.length ? [...ui, ...tokens] : [...packages];
}

// --- Changelog -------------------------------------------------------------------------------------------------------

export type UseRelease = ChangelogReleaseRow & { announcement: string };

/** Releases with their announcement ready to paste. */
export const withAnnouncements = (releases: readonly (ChangelogReleaseRow & { announcement?: string })[]): UseRelease[] =>
  releases.map((r) => ({ ...r, announcement: r.announcement ?? releaseAnnouncement(r) }));
