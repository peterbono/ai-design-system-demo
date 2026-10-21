// "How Bridge compares." on the homepage: a short table of seven rows, then every feature by group. Each cell is a
// check (yes) or a dash (not offered, only in part, or not documented); the nuances and sources live on /compare/.
// From public pages (October 2026). Pure data; components/home/HpCompare.astro renders it.
//
// Kept apart from lib/compare.ts on purpose: /compare/ lines Bridge up against a different set of tools (Chromatic and
// story.to.design, no Storybook), with other rows and partial cells. Sharing its TOOLS or ROWS would change what
// /compare/ shows.

export interface HomeRow {
  feature: string;
  /** A second line under the feature on wide screens; empty when the feature says it all. */
  detail: string;
  /** One cell per tool, in TOOLS order: true is a check, false a dash. */
  cells: boolean[];
}

export interface HomeGroup {
  name: string;
  rows: HomeRow[];
}

/** Columns, Bridge first. */
export const TOOLS = ['Bridge', 'Tokens Studio', 'Supernova', 'Storybook', 'zeroheight', 'Figma'] as const;

export const HEADING = 'How Bridge compares.';
export const HEAD_LINE = 'What each tool covers, from their public pages.';
export const AS_OF_LINE = 'From public pages, October 2026';
/** Words a screen reader hears for a check and a dash. */
export const YES = 'Yes';
export const NO = 'No';
/** The legend under the short table. */
export const KEY_YES = 'Yes';
export const KEY_NO = 'Not offered, only in part, or not documented';
export const SWIPE_HINT = 'Swipe the table to see every tool';
/** Names the short table and its scroll region. */
export const SHORT_CAPTION = 'Bridge and five design tools, the differences that matter most';
export const SHORT_FIRST_HEAD = 'What you need';
/** Names the full table and its scroll region. */
export const FULL_CAPTION = 'Bridge and five design tools, feature by feature';
export const FULL_FIRST_HEAD = 'Feature';
export const MORE_CLOSED = 'Compare every feature';
export const MORE_OPEN = 'Hide the full comparison';
export const DETAIL_LINK = 'See the comparison in detail, with sources';

const y = true;
const n = false;

// Cells in TOOLS order: Bridge, Tokens Studio, Supernova, Storybook, zeroheight, Figma.
export const SHORT: HomeRow[] = [
  { feature: 'Start an AI exploration on your real components', detail: 'In its own branch, with its own preview', cells: [y, n, n, n, n, n] },
  { feature: 'See what it adds that the library lacks', detail: 'New tokens, variants and components, listed', cells: [y, n, n, n, n, n] },
  { feature: 'Approve just the change, as a Git pull request', detail: 'Tokens, components and docs', cells: [y, n, n, n, n, n] },
  { feature: 'Figma kit built from code, with a fidelity check', detail: 'Pixel match between Figma and code', cells: [y, n, n, n, n, n] },
  {
    feature: 'Contrast and accessibility checked on every change',
    detail: 'CI fails a change that drops contrast below WCAG',
    cells: [y, n, n, n, n, n],
  },
  { feature: 'Open source', detail: '', cells: [y, n, n, y, n, n] },
  { feature: 'Free, with every feature', detail: 'No paid plan', cells: [y, n, n, y, n, n] },
];

export const GROUPS: HomeGroup[] = [
  {
    name: 'Tokens and Figma',
    rows: [
      { feature: 'Tokens in the W3C DTCG format', detail: '', cells: [y, y, n, n, y, y] },
      { feature: 'Two-way sync of Figma variables and Git', detail: '', cells: [y, y, n, n, n, n] },
      { feature: 'Figma components linked to code in Dev Mode', detail: '', cells: [n, n, n, n, n, y] },
    ],
  },
  {
    name: 'Review and history',
    rows: [
      { feature: 'Visual before and after of a change', detail: '', cells: [y, n, n, n, n, y] },
      { feature: 'Token history with revert', detail: '', cells: [y, n, n, n, n, n] },
    ],
  },
  {
    name: 'Code and docs',
    rows: [
      { feature: 'Workshop to build coded components', detail: '', cells: [n, n, n, y, n, n] },
      { feature: 'Docs drafted by AI, reviewed by people', detail: '', cells: [y, n, y, n, y, y] },
      { feature: 'Hosted documentation site', detail: '', cells: [y, n, y, n, y, n] },
      { feature: 'Adoption audit in product code', detail: '', cells: [y, n, y, n, y, n] },
    ],
  },
  {
    name: 'AI',
    rows: [{ feature: 'MCP server for AI agents', detail: '', cells: [y, n, y, n, y, y] }],
  },
];
