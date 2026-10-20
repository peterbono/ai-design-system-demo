// The product landing ("/"): its words that more than one place reads, and the pure geometry of the journey line.
// Every claim here is something Bridge ships today (ProdBranch, #163 and #164): Claude checks what an exploration
// added when it runs the check (MCP instructions, or `bridge pieces <n> --record`), a person opens each library
// branch in one click, the links go both ways, and the Figma kit updates with a Pull in the DS Bridge plugin.

export const INSTALL_COMMAND = 'npx @bridge-ds/cli init';

export interface Faq {
  id: string;
  question: string;
  answer: string;
}

export const FAQ: Faq[] = [
  {
    id: 'code-connect',
    question: 'We already use Figma Code Connect. Why Bridge?',
    answer:
      'Code Connect links Figma components that already exist to their code. Bridge brings what your exploration created into the system: Claude AI lines up each new piece as a library change, you review it in the product, and once it is merged the code ships and your Figma kit updates with a Pull in the DS Bridge plugin.',
  },
  {
    id: 'figma',
    question: 'Where do explorations come from?',
    answer:
      'An exploration is a prototype Claude AI builds in your product, on your real components, in its own branch with its own preview. Your Figma kit stays in step with the code: the DS Bridge plugin generates it from code, and a fidelity check compares the two.',
  },
  {
    id: 'existing',
    question: 'Does it work with our existing design system?',
    answer: 'Bridge works on your tokens (DTCG 2025.10) and your React components. Claude AI uses them through the Bridge MCP server and the CLI.',
  },
  {
    id: 'open-source',
    question: 'Is Bridge open source?',
    answer: 'Yes, under the MIT license, published as npm packages: @bridge-ds/react, tokens, core, cli and mcp.',
  },
];

/** "Same journey in your terminal": what a person says, then the real MCP tools Claude calls. */
export const TERMINAL: { say?: string; tool?: string; note: string }[] = [
  { say: 'Explore a billing screen with overdue invoices in Admin demo', note: '' },
  { tool: 'bridge_start_exploration', note: 'exploration opened, with its own preview' },
  { tool: 'bridge_missing_pieces', note: '1 piece missing: Badge, overdue tone' },
  { tool: 'bridge_open_library_branch', note: 'after you say yes: library branch opened, linked' },
  { tool: 'bridge_send_for_review', note: 'review asked' },
];

/** The terminal lines as one text block (the DS CodeBlock copies it as is). */
export function terminalText(lines = TERMINAL): string {
  return lines.map((l) => (l.say ? `> ${l.say}` : `${l.tool}  # ${l.note}`)).join('\n');
}

export interface Point {
  x: number;
  y: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * An SVG path through the points, top to bottom: each leg leaves and arrives vertically (cubic Bezier with control
 * points half way down the leg), so the line reads as one hand-drawn strand whatever the layout. Fewer than two
 * points: no path.
 */
export function journeyPath(points: Point[]): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  let d = `M${r1(first!.x)} ${r1(first!.y)}`;
  let prev = first!;
  for (const p of rest) {
    const mid = prev.y + (p.y - prev.y) / 2;
    d += ` C${r1(prev.x)} ${r1(mid)} ${r1(p.x)} ${r1(mid)} ${r1(p.x)} ${r1(p.y)}`;
    prev = p;
  }
  return d;
}

/**
 * Which station the reader is at: the last one whose top has passed the reading line (`line`, in the same
 * coordinates as `tops`). -1 before the first.
 */
export function currentStation(tops: number[], line: number): number {
  let at = -1;
  tops.forEach((t, i) => {
    if (t <= line) at = i;
  });
  return at;
}

/**
 * How much of a path to draw for a reading line at `y`: the largest length whose point is at or above `y`, found by
 * bisection over `pointAt` (the SVG path's getPointAtLength), since the path only goes down. Clamped to [0, total].
 */
export function drawnLength(total: number, y: number, pointAt: (len: number) => Point, steps = 24): number {
  if (total <= 0) return 0;
  if (pointAt(total).y <= y) return total;
  if (pointAt(0).y > y) return 0;
  let lo = 0;
  let hi = total;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (pointAt(mid).y <= y) lo = mid;
    else hi = mid;
  }
  return lo;
}
