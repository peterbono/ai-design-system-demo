// "How Bridge compares.": one source for the homepage table (components/home/HpCompare.astro) and /compare/
// (pages/compare.astro). Each cell is a check (does it), a half mark (does part of it, with the reason) or a dash
// (doesn't, or isn't documented). From the tools' public pages, October 2026; the source of every cell is listed in
// SOURCES and quoted in the pull request that last changed it. Pure data and helpers.

export type CellState = 'yes' | 'partial' | 'no';

export interface Cell {
  state: CellState;
  /** What the tool does, in one line. Required on a half mark; optional on a check, to say how. */
  note?: string;
}

export interface CompareRow {
  feature: string;
  /** A second line under the feature on wide screens; empty when the feature says it all. */
  detail: string;
  /** One cell per tool, in TOOLS order, Bridge first. */
  cells: Cell[];
}

export interface CompareGroup {
  name: string;
  rows: CompareRow[];
}

/** Columns, Bridge first. */
export const TOOLS = ['Bridge', 'Tokens Studio', 'Supernova', 'Storybook', 'zeroheight', 'Figma'] as const;

export const AS_OF = 'October 2026';
export const HEADING = 'How Bridge compares.';
export const HEAD_LINE = 'What each tool covers, from their public pages.';
export const AS_OF_LINE = `From public pages, ${AS_OF}`;

/** The words a mark reads, for screen readers and on /compare/. */
export const STATE_LABEL: Record<CellState, string> = { yes: 'Yes', partial: 'In part', no: 'No' };
/** The legend under the short table, one entry per mark. */
export const KEY: Record<CellState, string> = {
  yes: 'Does it',
  partial: 'Does part of it',
  no: 'Does not, or not documented',
};
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

const y = (note?: string): Cell => ({ state: 'yes', note });
const p = (note: string): Cell => ({ state: 'partial', note });
const n: Cell = { state: 'no' };

// Cells in TOOLS order: Bridge, Tokens Studio, Supernova, Storybook, zeroheight, Figma.
export const SHORT: CompareRow[] = [
  {
    feature: 'Start an AI exploration with your design system',
    detail: 'In its own branch, with its own preview',
    cells: [
      y(),
      n,
      p('AI prototypes with your code components and a share link, in beta. No branch found.'),
      p('A coding agent builds with your stories through its MCP server, in preview. The branch is yours to set up.'),
      p('Gives your system to Figma Make and coding agents through MCP. It does not run the exploration itself.'),
      y('Figma Make with a kit of your code components, in a Git branch, with a live preview. Paid plans.'),
    ],
  },
  {
    feature: 'See what an exploration adds that the library lacks',
    detail: 'New tokens, variants and components, listed',
    cells: [
      y(),
      p('A branch lists the tokens it adds, changes and removes. Not components.'),
      n,
      p('With Chromatic, a review shows the stories that changed visually.'),
      p('Its MCP audit flags design and code inconsistencies before a merge.'),
      p('Check designs flags hard-coded values and detached components, one page at a time.'),
    ],
  },
  {
    feature: 'Your DS lead approves just the change',
    detail: 'Before it reaches the library',
    cells: [
      y(),
      y('Branch review with Approve or Request changes, for tokens.'),
      p('An approval workflow for doc pages, on Enterprise.'),
      p('Through your Git host, or Chromatic UI Review.'),
      p('Token changes go back to code as a pull request. No approval step of its own.'),
      y('Branch review with Approve or Suggest changes, on Organization and Enterprise.'),
    ],
  },
  {
    feature: 'One review for tokens, code and docs',
    detail: 'Traced back to the exploration, in Git, with checks',
    cells: [
      y(),
      p('Tokens only.'),
      p('Doc pages; code comes as pipeline pull requests.'),
      p('Code and stories, in your Git review.'),
      p('Docs, plus token pull requests.'),
      p('Design files in branch review; Make code in GitHub pull requests.'),
    ],
  },
  {
    feature: 'Figma kit built from code, with a fidelity check',
    detail: 'Pixel match between Figma and code',
    cells: [
      y(),
      p('Tokens become Figma variables and styles. Not components.'),
      n,
      n,
      n,
      p('An agent skill builds components from code, in beta. Drift checks cover tokens only.'),
    ],
  },
  {
    feature: 'Open source',
    detail: '',
    cells: [
      y('MIT.'),
      p('The Figma plugin is MIT; the platform is not.'),
      p('The code exporters are MIT; the platform is not.'),
      y('MIT.'),
      n,
      n,
    ],
  },
  {
    feature: 'Free, with every feature',
    detail: 'No paid plan',
    cells: [
      y(),
      n,
      n,
      y('Chromatic, its visual testing service, is paid.'),
      n,
      n,
    ],
  },
];

export const GROUPS: CompareGroup[] = [
  {
    name: 'Tokens and Figma',
    rows: [
      {
        feature: 'Tokens in the W3C standard format',
        detail: '',
        cells: [y(), y(), n, n, y(), y('Variables import and export.')],
      },
      {
        feature: 'Two-way sync between Figma variables and code',
        detail: '',
        cells: [
          y(),
          y('Git sync on paid plans.'),
          p('Tokens come in from Figma and Git and go out as pull requests; Figma import is one way.'),
          n,
          p('Two-way with Git; Figma variables come in one way.'),
          p('An agent skill syncs variables and code with drift detection, in beta.'),
        ],
      },
      {
        feature: 'UI kit linked to code',
        detail: '',
        cells: [
          y('The kit is built from code, linked to Storybook, and checked for fidelity.'),
          p('Tokens only: token names show in Dev Mode.'),
          y('A component links its Figma component and its code repository.'),
          y('Storybook Connect, by Chromatic, links stories to Figma components.'),
          p('Figma and Storybook side by side in doc pages.'),
          y('Code Connect in Dev Mode, on Organization and Enterprise.'),
        ],
      },
    ],
  },
  {
    name: 'Review and history',
    rows: [
      {
        feature: 'Visual before and after of a change',
        detail: '',
        cells: [
          y('On the coded stories and app screens, in every brand and theme, in the pull request.'),
          p('Token values before and after, not a visual.'),
          p('Page history for doc pages, not a visual of components.'),
          p('With Chromatic, a separate paid service.'),
          n,
          y('Branch review, side by side or as an overlay.'),
        ],
      },
      {
        feature: 'Contrast checked on every change',
        detail: '',
        cells: [
          y('220 token pairs in every brand and theme, in CI; a failing change cannot merge.'),
          p('Contrast nodes in Graph Engine, not a check on each change.'),
          p('An accessibility color grid in docs, not a check on each change.'),
          y('The accessibility addon runs axe on stories, and fails CI when set to.'),
          n,
          p('Check designs tests contrast on demand, one page at a time.'),
        ],
      },
      {
        feature: 'Token history with revert',
        detail: '',
        cells: [
          y(),
          p('Release history of token changes; reverting goes through Git.'),
          p('Versions are read-only; restore is for doc pages.'),
          n,
          p('Tokens follow styleguide releases, on paid plans.'),
          p('Version history restores a whole file, not one variable.'),
        ],
      },
    ],
  },
  {
    name: 'Code and docs',
    rows: [
      {
        feature: 'Workshop to build coded components',
        detail: '',
        cells: [p('Bridge ships its components with Storybook and builds on it.'), n, n, y(), n, n],
      },
      { feature: 'Docs drafted by AI, reviewed by people', detail: '', cells: [y(), n, y(), n, y(), y('With the Figma agent.')] },
      {
        feature: 'Hosted documentation site',
        detail: '',
        cells: [y(), n, y(), p('A static build you host, or publish with Chromatic.'), y(), p('Figma Sites, with no docs template.')],
      },
      {
        feature: 'Adoption audit in product code',
        detail: '',
        cells: [
          y(),
          n,
          y('On Enterprise.'),
          n,
          y('On Enterprise, for React and Angular.'),
          p('Library analytics count use in Figma files, not code.'),
        ],
      },
    ],
  },
  {
    name: 'AI',
    rows: [
      {
        feature: 'Works with AI agents, through MCP',
        detail: '',
        cells: [y(), n, y(), y('MCP server in preview.'), y(), y()],
      },
    ],
  },
];

/** Every row: the short table first, then the groups. */
export const ALL_ROWS: CompareRow[] = [...SHORT, ...GROUPS.flatMap((g) => g.rows)];

/** Public pages the cells come from, per tool (/compare/ lists them). */
export const SOURCES: Record<(typeof TOOLS)[number], { label: string; href: string }[]> = {
  Bridge: [{ label: 'Bridge on GitHub', href: 'https://github.com/peterbono/ai-design-system-demo' }],
  'Tokens Studio': [
    { label: 'Branch reviews', href: 'https://documentation-v2.tokens.studio/branching/branch-reviews.html' },
    { label: 'Pricing', href: 'https://tokens.studio/pricing' },
  ],
  Supernova: [
    { label: 'Pricing', href: 'https://www.supernova.io/pricing' },
    { label: 'Workflows', href: 'https://learn.supernova.io/latest/documentation/documentation-settings/workflows-d6QtSgzV' },
    { label: 'AI prototyping', href: 'https://www.supernova.io/blog/january-2026-product-updates' },
  ],
  Storybook: [
    { label: 'MCP', href: 'https://storybook.js.org/docs/ai/mcp/overview' },
    { label: 'Accessibility tests', href: 'https://storybook.js.org/docs/writing-tests/accessibility-testing' },
    { label: 'Chromatic UI Review', href: 'https://www.chromatic.com/docs/review' },
  ],
  zeroheight: [
    { label: 'MCP', href: 'https://zeroheight.com/mcp/' },
    { label: 'Pricing', href: 'https://zeroheight.com/pricing/' },
  ],
  Figma: [
    { label: 'Make kits', href: 'https://help.figma.com/hc/en-us/articles/39241689698839-Get-started-with-Make-kits' },
    { label: 'Git in Make', href: 'https://help.figma.com/hc/en-us/articles/44220165255063-Use-Git-with-Figma-Make-and-code-layers' },
    { label: 'Branch review', href: 'https://help.figma.com/hc/en-us/articles/5693123873687-Review-branch-changes' },
    { label: 'Check designs', href: 'https://help.figma.com/hc/en-us/articles/39592284074263-Check-designs-in-Figma' },
    { label: 'Agents on the canvas', href: 'https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/' },
  ],
};

/** The words a cell reads: "Yes", "In part: tokens only.", "No". */
export function cellText(c: Cell): string {
  return c.note ? `${STATE_LABEL[c.state]}: ${c.note}` : STATE_LABEL[c.state];
}
