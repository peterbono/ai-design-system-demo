// "How Bridge compares.": one source for the homepage table (components/home/HpCompare.astro) and /compare/
// (pages/compare.astro). Each cell is a check (does it), a short label of 2 to 4 words saying what is missing or
// limited (does part of it, with the reason in its note) or a dash (doesn't, or isn't documented). From the tools' public pages, October 2026; the source of every cell is listed in
// SOURCES and quoted in the pull request that last changed it. Pure data and helpers.

export type CellState = 'yes' | 'partial' | 'no';

export interface Cell {
  state: CellState;
  /** What the tool does, in one line. Required on a partial cell; optional on a check, to say how. */
  note?: string;
  /**
   * The words the cell shows, 2 to 4 words condensed from the note. Required on a partial cell (it shows no mark);
   * optional on a check, as a grey qualifier under it ("Paid plans").
   */
  short?: string;
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

/** The words a state reads, for screen readers and on /compare/. */
export const STATE_LABEL: Record<CellState, string> = { yes: 'Yes', partial: 'In part', no: 'No' };
/** The states drawn as a mark; a partial cell shows its short label instead. */
export type MarkState = Exclude<CellState, 'partial'>;
/** The legend under the tables, one entry per mark. */
export const KEY: Record<MarkState, string> = {
  yes: 'Does it',
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

const y = (note?: string, short?: string): Cell => (short ? { state: 'yes', note, short } : { state: 'yes', note });
const p = (short: string, note: string): Cell => ({ state: 'partial', short, note });
const n: Cell = { state: 'no' };

// Cells in TOOLS order: Bridge, Tokens Studio, Supernova, Storybook, zeroheight, Figma.
export const SHORT: CompareRow[] = [
  {
    feature: 'Start an AI exploration with your design system',
    detail: 'In its own branch, with its own preview',
    cells: [
      y(),
      n,
      p('Beta, no branch', 'AI prototypes with your code components and a share link, in beta. No branch found.'),
      p('Agent via MCP', 'A coding agent builds with your stories through its MCP server, in preview. The branch is yours to set up.'),
      p('Feeds other AI tools', 'Gives your system to Figma Make and coding agents through MCP. It does not run the exploration itself.'),
      y('Figma Make with a kit of your code components, in a Git branch, with a live preview. Paid plans.', 'Paid plans'),
    ],
  },
  {
    feature: 'See what an exploration adds that the library lacks',
    detail: 'New tokens, variants and components, listed',
    cells: [
      y(),
      p('Tokens only', 'A branch lists the tokens it adds, changes and removes. Not components.'),
      n,
      p('Visual diffs via Chromatic', 'With Chromatic, a review shows the stories that changed visually.'),
      p('Audit via MCP', 'Its MCP audit flags design and code inconsistencies before a merge.'),
      p('Page by page audit', 'Check designs flags hard-coded values and detached components, one page at a time.'),
    ],
  },
  {
    feature: 'Your DS lead approves just the change',
    detail: 'Before it reaches the library',
    cells: [
      y(),
      y('Branch review with Approve or Request changes, for tokens.', 'For tokens'),
      p('Docs only, Enterprise', 'An approval workflow for doc pages, on Enterprise.'),
      p('Via Git or Chromatic', 'Through your Git host, or Chromatic UI Review.'),
      p('No approval step', 'Token changes go back to code as a pull request. No approval step of its own.'),
      y('Branch review with Approve or Ask for changes, on Organization and Enterprise.'),
    ],
  },
  {
    feature: 'One review for tokens, code and docs',
    detail: 'Traced back to the exploration, in Git, with checks',
    cells: [
      y(),
      p('Tokens only', 'Tokens only.'),
      p('Docs only', 'Doc pages; code comes as pipeline pull requests.'),
      p('Code only', 'Code and stories, in your Git review.'),
      p('Docs and tokens', 'Docs, plus token pull requests.'),
      p('Two separate reviews', 'Design files in branch review; Make code in GitHub pull requests.'),
    ],
  },
  {
    feature: 'Figma kit built from code, with a fidelity check',
    detail: 'Pixel match between Figma and code',
    cells: [
      y(),
      p('Tokens only', 'Tokens become Figma variables and styles. Not components.'),
      n,
      n,
      n,
      p('Beta, no fidelity check', 'An agent skill builds components from code, in beta. Drift checks cover tokens only.'),
    ],
  },
  {
    feature: 'Open source',
    detail: '',
    cells: [
      y('MIT.'),
      p('Plugin only', 'The Figma plugin is MIT; the platform is not.'),
      p('Exporters only', 'The code exporters are MIT; the platform is not.'),
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
      y('Chromatic, its visual testing service, is paid.', 'Chromatic is paid'),
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
          y('Git sync on paid plans.', 'Paid plans'),
          p('Figma import one way', 'Tokens come in from Figma and Git and go out as pull requests; Figma import is one way.'),
          n,
          p('Figma one way', 'Two-way with Git; Figma variables come in one way.'),
          p('Agent skill, in beta', 'An agent skill syncs variables and code with drift detection, in beta.'),
        ],
      },
      {
        feature: 'UI kit linked to code',
        detail: '',
        cells: [
          y('The kit is built from code, linked to Storybook, and checked for fidelity.'),
          p('Tokens only', 'Tokens only: token names show in Dev Mode.'),
          y('A component links its Figma component and its code repository.'),
          y('Storybook Connect, by Chromatic, links stories to Figma components.'),
          p('Shown side by side', 'Figma and Storybook side by side in doc pages.'),
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
          p('Values, not visual', 'Token values before and after, not a visual.'),
          p('Doc page history', 'Page history for doc pages, not a visual of components.'),
          p('Via paid Chromatic', 'With Chromatic, a separate paid service.'),
          n,
          y('Branch review, side by side or as an overlay.'),
        ],
      },
      {
        feature: 'Contrast checked on every change',
        detail: '',
        cells: [
          y('220 token pairs in every brand and theme, in CI; a failing change cannot merge.'),
          p('Graph Engine nodes', 'Contrast nodes in Graph Engine, not a check on each change.'),
          p('Color grid in docs', 'An accessibility color grid in docs, not a check on each change.'),
          y('The accessibility addon runs axe on stories, and fails CI when set to.'),
          n,
          p('On demand, per page', 'Check designs tests contrast on demand, one page at a time.'),
        ],
      },
      {
        feature: 'Token history with revert',
        detail: '',
        cells: [
          y(),
          p('Revert through Git', 'Release history of token changes; reverting goes through Git.'),
          p('Read-only versions', 'Versions are read-only; restore is for doc pages.'),
          n,
          p('Releases, paid plans', 'Tokens follow styleguide releases, on paid plans.'),
          p('Whole file only', 'Version history restores a whole file, not one variable.'),
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
        cells: [p('Built on Storybook', 'Bridge ships its components with Storybook and builds on it.'), n, n, y(), n, n],
      },
      { feature: 'Docs drafted by AI, reviewed by people', detail: '', cells: [y(), n, y(), n, y(), y('With the Figma agent.')] },
      {
        feature: 'Hosted documentation site',
        detail: '',
        cells: [y(), n, y(), p('Static build, self-hosted', 'A static build you host, or publish with Chromatic.'), y(), p('No docs template', 'Figma Sites, with no docs template.')],
      },
      {
        feature: 'Adoption audit in product code',
        detail: '',
        cells: [
          y(),
          n,
          y('On Enterprise.', 'Enterprise'),
          n,
          y('On Enterprise, for React and Angular.', 'Enterprise'),
          p('Figma files only', 'Library analytics count use in Figma files, not code.'),
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
        cells: [y(), n, y(), y('MCP server in preview.', 'In preview'), y(), y()],
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

/**
 * The words a cell reads: "Yes", "No", "Yes: MIT.", or with a short label "In part: Tokens only." then the note
 * when it says more than the label.
 */
export function cellText(c: Cell): string {
  const state = STATE_LABEL[c.state];
  if (!c.short) return c.note ? `${state}: ${c.note}` : state;
  const head = `${state}: ${c.short}.`;
  return c.note && c.note !== `${c.short}.` ? `${head} ${c.note}` : head;
}
