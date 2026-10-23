// Where a designer sees what they sent: the change in Bridge Studio for their team (the primary link after a send),
// GitHub one step behind it. And the message a designer hands a developer when a component needs code.

import { parseRepo } from '@bridge-ds/core';
import { STUDIO_ORIGIN } from '../shared/messages';
import type { PublishResult } from './publish';

/** How Studio opens a change: a branch in review, a suggestion, a component request, an exploration. */
export type StudioTarget = 'pr' | 'suggestion' | 'request' | 'exploration';

/**
 * The change in Studio for the team of `repo`: /studio/~/<owner>/<repo>/changes/?pr=12. The escape form (~) always
 * opens the team, whatever its name. Undefined when `repo` is not a repository.
 */
export function studioChangeUrl(repo: string, target: StudioTarget, number: number): string | undefined {
  let r: { owner: string; name: string };
  try {
    r = parseRepo(repo);
  } catch {
    return undefined;
  }
  return `${STUDIO_ORIGIN}/studio/~/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}/changes/?${target}=${number}`;
}

/** The team's Studio home (no change open). */
export function studioTeamUrl(repo: string): string | undefined {
  return studioChangeUrl(repo, 'pr', 0)?.replace(/changes\/\?pr=0$/, '');
}

export interface SentLinks {
  /** "See it in Studio": the main thing the send made. */
  studio?: string | undefined;
  /** "Open on GitHub": the same thing on GitHub. */
  github?: string | undefined;
}

/**
 * The links of a send, the main thing first: the exploration, the branch with the variable edits, a suggestion, a
 * component's library branch, then a request.
 */
export function sentLinks(repo: string, res: Pick<PublishResult, 'pr' | 'suggestions' | 'branches' | 'requests'>, exploration?: { number: number; url: string } | undefined): SentLinks {
  const pick = (target: StudioTarget, x: { number: number; url: string } | undefined): SentLinks | undefined => (x ? { studio: studioChangeUrl(repo, target, x.number), github: x.url } : undefined);
  return (
    pick('exploration', exploration) ??
    pick('pr', res.pr ? { number: res.pr.pr.number, url: res.pr.pr.url } : undefined) ??
    pick('suggestion', res.suggestions[0]) ??
    pick('pr', res.branches.find((b) => !b.suggested)) ??
    pick('suggestion', res.branches.find((b) => b.suggested)) ??
    pick('request', res.requests[0]) ??
    {}
  );
}

/** A component whose code a developer builds with Claude: its library branch (direct) or its suggestion. */
export interface BuildItem {
  component: string;
  number: number;
  url: string;
  /** Sent as a suggestion: a developer applies it first. */
  suggested?: boolean | undefined;
}

/**
 * The message a designer copies for a developer when a component needs code. Nothing builds it on its own: the
 * branch (or suggestion) carries the spec and a screenshot, and the developer builds it with Claude through the
 * Bridge MCP server or the CLI. Developer words are fine here: a developer reads it.
 */
export function developerMessage(repo: string, items: BuildItem[]): string {
  if (!items.length) return '';
  const one = items.length === 1;
  const names = items.map((x) => x.component);
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const lines = [
    `Hi! I changed ${list} in Figma and sent ${one ? 'it' : 'them'} with Bridge. ${one ? 'It needs' : 'They need'} code: could you build ${one ? 'it' : 'them'} with Claude?`,
    '',
    ...items.flatMap((x) => {
      const studio = studioChangeUrl(repo, x.suggested ? 'suggestion' : 'pr', x.number);
      return [`${x.component}: ${studio ?? x.url}`, ...(studio ? [`  GitHub: ${x.url}`] : [])];
    }),
    '',
    items.some((x) => !x.suggested)
      ? `Each branch carries the spec and a screenshot. In Claude, with the Bridge MCP server: "Build the Figma change #${items.find((x) => !x.suggested)!.number}" (bridge_get_figma_change gives the brief), or in a terminal: bridge figma show ${items.find((x) => !x.suggested)!.number}.`
      : 'Each suggestion carries the spec and the Figma links. Apply it with bridge_apply_suggestion in Claude, which returns the brief to build it.',
  ];
  return lines.join('\n');
}
