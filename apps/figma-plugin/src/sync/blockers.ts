// What stops a send, in designer words: one line per kind of problem with its count ("3 color pairs are too low in
// contrast on their backgrounds"), never one line per token pair. The exact messages (token paths, contrast.checks.json)
// stay for developers. Pure: no DOM.

import type { Issue, IssueCode } from '@bridge-ds/core';

export interface BlockerLine {
  code: IssueCode;
  count: number;
  /** One sentence, plural-aware, with what to do. */
  text: string;
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The sentence for `count` problems of one kind. Unknown kinds keep their own message (the first one). */
function sentence(code: IssueCode, count: number, first: Issue): string {
  const are = count === 1 ? 'is' : 'are';
  switch (code) {
    case 'contrast':
      return `${n(count, 'color pair', 'color pairs')} ${are} too low in contrast on ${count === 1 ? 'its background' : 'their backgrounds'}. Pick a stronger color, or uncheck the edit.`;
    case 'contrast-unresolved':
      return `${n(count, 'color pair', 'color pairs')} could not be checked for contrast: a color does not lead to a value.`;
    case 'raw-value':
      return `${n(count, 'variable has', 'variables have')} a typed value where ${count === 1 ? 'it' : 'they'} must point to another variable. Pick a variable instead.`;
    case 'alias-tier':
      return `${n(count, 'variable points', 'variables point')} to a variable ${count === 1 ? 'it' : 'they'} cannot use. Pick one from the collection it expects.`;
    case 'broken-reference':
      return `${n(count, 'variable points', 'variables point')} to a variable that no longer exists. Pick another one.`;
    case 'alias-cycle':
      return `${n(count, 'variable points', 'variables point')} back to ${count === 1 ? 'itself' : 'each other'} in a loop. Point one of them to a value.`;
    case 'missing-mode':
      return `${n(count, 'variable has', 'variables have')} no value in some modes. Fill every mode.`;
    case 'override-orphan':
    case 'override-shadowed':
      return `${n(count, 'theme override does', 'theme overrides do')} not match a variable of the design system.`;
    case 'type-change':
      return `${n(count, 'variable changed', 'variables changed')} type. Change it back, or ask a developer.`;
    case 'all-scopes':
      return `${n(count, 'variable is', 'variables are')} offered for every property in Figma. Limit where ${count === 1 ? 'it applies' : 'they apply'}.`;
    default:
      return count === 1 ? first.message : `${first.message} And ${count - 1} more like it.`;
  }
}

/** Issues grouped by kind, biggest group first; file problems keep one line each (their message is the problem). */
export function blockerLines(issues: readonly Issue[]): BlockerLine[] {
  const groups = new Map<string, Issue[]>();
  for (const i of issues) {
    const key = i.code === 'file-problem' ? `file-problem|${i.message}` : i.code === 'override-shadowed' ? 'override-orphan' : i.code;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.values()]
    .map((list) => {
      // Both override problems read as one kind ("theme overrides do not match").
      const code: IssueCode = list[0]!.code === 'override-shadowed' ? 'override-orphan' : list[0]!.code;
      return { code, count: list.length, text: sentence(code, list.length, list[0]!) };
    })
    .sort((a, b) => b.count - a.count);
}
