// The comparison on /compare/: Bridge next to the tools teams already use, from their public pages (October 2026).
// Honest by construction: partials keep what the tool does, unknowns stay unknown, every tool links its source.
// Pure data and helpers; pages/compare.astro renders it.

export type CellState = 'yes' | 'partial' | 'no' | 'unknown';

export interface Cell {
  state: CellState;
  /** What the tool does, for partials and nuanced answers, as it reads after "Partial: " ("token-only Git branches"). */
  note?: string;
}

export interface Tool {
  id: string;
  name: string;
  /** The public page the cells come from. */
  source: { label: string; href: string };
  /** Extra sources (Figma's Code Connect pages). */
  more?: { label: string; href: string }[];
}

export interface Row {
  feature: string;
  /** One cell per tool in TOOLS order; Bridge is always yes. */
  cells: Cell[];
}

export const AS_OF = 'October 2026';

export const TOOLS: Tool[] = [
  { id: 'supernova', name: 'Supernova', source: { label: 'supernova.io/pricing', href: 'https://www.supernova.io/pricing' } },
  { id: 'zeroheight', name: 'zeroheight', source: { label: 'zeroheight.com/pricing', href: 'https://zeroheight.com/pricing' } },
  { id: 'tokens-studio', name: 'Tokens Studio', source: { label: 'tokens.studio/pricing', href: 'https://tokens.studio/pricing' } },
  {
    id: 'figma',
    name: 'Figma',
    source: { label: 'help.figma.com', href: 'https://help.figma.com' },
    more: [
      { label: 'Code Connect UI setup', href: 'https://developers.figma.com/docs/code-connect/code-connect-ui-setup/' },
      { label: 'Comparing Code Connect UI and CLI', href: 'https://developers.figma.com/docs/code-connect/comparing-cc/' },
    ],
  },
  { id: 'chromatic', name: 'Chromatic', source: { label: 'chromatic.com/docs/review', href: 'https://www.chromatic.com/docs/review' } },
  { id: 'story-to-design', name: 'story.to.design', source: { label: 'story.to.design', href: 'https://story.to.design' } },
];

const y = (note?: string): Cell => ({ state: 'yes', note });
const p = (note?: string): Cell => ({ state: 'partial', note });
const n = (note?: string): Cell => ({ state: 'no', note });
const u: Cell = { state: 'unknown' };

// Cells in TOOLS order: Supernova, zeroheight, Tokens Studio, Figma, Chromatic, story.to.design.
export const ROWS: Row[] = [
  { feature: 'Git branches and review for designers', cells: [n('versions only'), n(), p('token-only Git branches'), p('branches, not Git'), p('code review for developers'), n()] },
  { feature: 'Review shows the change in the product', cells: [n(), n(), u, p('canvas diff, no review in the product'), p('component stories'), p('diff before sync')] },
  { feature: 'Product feature linked to the library change it needs', cells: [n(), n(), n(), n(), n(), n()] },
  { feature: 'Combined preview of several changes', cells: [n(), n(), u, n(), n(), n()] },
  { feature: 'Code to Figma UI kit', cells: [n(), n(), p('variables only'), p('plain layers; Code Connect builds no kit from code and syncs neither way'), n(), y()] },
  { feature: 'Code and Figma fidelity check', cells: [n(), n(), n(), n('Code Connect links components, no match check'), p('manual side by side'), n()] },
  { feature: 'Adoption audit in products', cells: [y('Enterprise'), y('CLI'), n(), p('Figma files only'), n(), n()] },
  { feature: 'Contrast gate on token changes', cells: [u, u, u, p('in design files'), p('component axe checks'), n()] },
  { feature: 'Docs drafted by AI, reviewed by people', cells: [y(), y(), n(), n(), n(), n()] },
  { feature: 'MCP and agent context', cells: [y(), y(), n(), y('Figma MCP, with Code Connect links'), p(), n()] },
  { feature: 'Open source', cells: [n(), n(), p('plugin'), n(), n('Storybook is'), n()] },
  { feature: 'No customer code stored', cells: [n('inference'), p(), p(), p(), n(), u] },
];

/** What Figma's Code Connect does, said once under the table (sources in TOOLS). */
export const FIGMA_NOTE =
  'Figma Code Connect UI is on the Organization and Enterprise plans. It links Figma components that already exist to their code, for Dev Mode and the Figma MCP server. It does not sync either way, generate a kit from code, check that the two match, or review a change in the product.';

export const STATE_LABEL: Record<CellState, string> = { yes: 'Yes', partial: 'Partial', no: 'No', unknown: 'Unknown' };

/** The words a cell reads: "Yes", "Partial: token-only Git branches", "No: versions only", "Unknown". */
export function cellText(c: Cell): string {
  return c.note ? `${STATE_LABEL[c.state]}: ${c.note}` : STATE_LABEL[c.state];
}
