// The live summary sentence of a Studio page header (components/StudioHeader.astro, ds/studio/StudioHead.tsx): one
// sentence about the state of the page, written by the island that knows it (the changes list, Being built, the
// team's components and quality, the token explorer). The header renders the slot; the islands fill it.

/** The header's summary slot. */
export const SUMMARY_SELECTOR = '[data-st-summary]';

/** Writes the page's summary sentence into its header (nothing when the page has no header slot). */
export function setPageSummary(text: string | null | undefined, root: ParentNode = document): void {
  const el = root.querySelector<HTMLElement>(SUMMARY_SELECTOR);
  if (!el) return;
  el.textContent = text ?? '';
}

/** The header's actions slot, for an island whose primary action belongs on the title's line. */
export const ACTIONS_SELECTOR = '[data-st-actions]';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** Changes: what is open, by where it stands. "2 explorations running, 1 waiting for a developer." */
export function changesSummary(c: Partial<Record<'not-started' | 'exploring' | 'draft' | 'review' | 'code', number>>): string {
  const parts = [
    c.exploring ? `${count(c.exploring, 'exploration')} running` : '',
    c['not-started'] ? `${c['not-started']} not started` : '',
    c.draft ? count(c.draft, 'draft') : '',
    c.review ? `${c.review} in review` : '',
    c.code ? `${c.code} waiting for a developer` : '',
  ].filter(Boolean);
  return parts.length ? `${cap(parts.join(', '))}.` : 'Nothing in progress right now.';
}

/** Tokens: how many, and in which themes. "119 tokens, light and dark." */
export function tokensSummary(n: number, themes: readonly string[]): string {
  const names = themes.filter(Boolean).map((t) => t.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : '';
  return `${cap(count(n, 'token'))}${list ? `, ${list}` : ''}.`;
}
