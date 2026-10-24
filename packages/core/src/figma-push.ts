// Components pushed from Figma: a component a designer changed in Figma comes back to the coded library as a library
// branch, routed by what Bridge can write with certainty:
// - exact, no AI: the only change is a token swap (a padding, a radius, a colour now bound to another variable) on a
//   property code paints through a component token used nowhere else. It becomes a token change: that component token
//   now points to the new variable, checked for contrast and reviewed like any token change.
// - built by a developer with Claude, reviewed by a person: a new variant, a new property, layers added or moved, a new component,
//   or a token swap code cannot express with a token alone. The structured diff (variant matrix, properties, bound
//   variables, layers, screenshot) goes on a library branch as a spec; Claude writes the code there through the MCP
//   server. Until it has, the branch says so: it carries the spec as a request, labelled "waiting for Claude".
// - manual: what the scan cannot read with confidence (a detached layer, a raw value, a variable code does not have).
//   Each one is listed with what to do. Never dropped silently, never sent.
// Once a library branch ships, a pull rebuilds the Figma component from the reviewed code, so Figma never diverges.
//
// Pure and browser safe: the Figma plugin, the MCP server and the CLI share these rules. The GitHub writes are in
// figma-push-github.ts.

import { shortVariants } from './change-drafts';
import { variantKeyOf, type ComponentSpecsFile } from './component-spec';
import { slugify } from './pr-composer';
import { REQUEST_KINDS, requestIssueTitle, type RequestChange, type RequestKind, type RequestSource } from './requests';
import type { TokenEdit } from './token-edits';
import type { ContrastPair } from './wcag';

/** Where a component change goes: a token change (exact), a library branch Claude drafts, or nowhere yet (manual). */
export type PushRoute = 'token-change' | 'claude-draft' | 'manual';

/** A token swap seen in Figma: in these variants, one property moved from one variable to another (token paths). */
export interface Rebind {
  /** Property family, as the scan names it: fill, stroke, radius, padding, gap, size, typography... */
  kind: string;
  /** Variant names ("Size=md, Tone=primary") where it moved. */
  variants: string[];
  /** Every variant of the component moved the same way. */
  allVariants: boolean;
  before: string[];
  after: string[];
  /** Values set by hand where a variable went (the property was unbound), with the variables that hold each. */
  raw?: UnboundValue[] | undefined;
}

/** A value set by hand in Figma ("#FF00AA", "12") and the Figma variables whose value equals it ("radius/control"). */
export interface UnboundValue {
  value: string;
  matches?: string[] | undefined;
}

/** An edit the scan cannot read with confidence, and what the designer does about it. */
export interface PushIssue {
  what: string;
  todo: string;
  /** A property set by hand: where, and its values, so the designer sees them and can bind a variable that holds one. */
  raw?: { kind: string; variants: string[]; values: UnboundValue[] } | undefined;
}

/**
 * A component change from Figma, structured: what the designer sees in the Push tab, and what the library branch
 * carries as its spec (the JSON Claude reads to write the code).
 */
export interface ComponentPushDiff {
  v: 1;
  /** Coded name ("Button"), or the proposed name of a new component ("DatePicker"). */
  component: string;
  /** Name of the set in Figma ("Forms / Date picker"). */
  figmaName: string;
  /** The component has a folder in code. */
  coded: boolean;
  kind: RequestKind;
  /** One line, sentence case: "Add a lg size". */
  title: string;
  summary: string;
  /** What changes, in one sentence. */
  line?: string | undefined;
  /** The rows of the change, as the Push tab lists them. */
  changes: RequestChange[];
  /** Token swaps, for the exact route. */
  rebinds: Rebind[];
  /** Something only code can carry: a variant, a property, layers, a swapped instance, a new component. */
  needsCode: boolean;
  /** Edits the scan cannot read with confidence: listed with what to do, never sent. */
  unknown: PushIssue[];
  figma?:
    | {
        fileKey?: string | undefined;
        nodeId?: string | undefined;
        nodeName?: string | undefined;
        url?: string | undefined;
        /** A node that shows the design before the change, when the file keeps one (optional). */
        before?: { nodeId: string; nodeName?: string | undefined; url?: string | undefined } | undefined;
      }
    | undefined;
  /** The component as Figma has it now: variant axes, properties, bound variables (token paths) per variant. */
  variantAxes: Record<string, string[]>;
  properties: { name: string; type: string; default: string }[];
  bindings: Record<string, Record<string, string[]>>;
  /** Layers of each variant, in order, as words ("instance Icon/Pencil, \"Icon\""). */
  anatomy: Record<string, string[]>;
  /** What code gave Figma at the last pull, when known. */
  before?: { variantAxes: Record<string, string[]>; properties: { name: string; type: string; default: string }[] } | undefined;
  /** Screenshot URLs (Figma exports on the requests branch). */
  images?: string[] | undefined;
  source: RequestSource;
  requestedBy?: string | undefined;
}

/** What the plan needs to know about tokens, from wherever the caller reads them (the plugin, the MCP server). */
export interface PushTokenContext {
  /** Tier of a token path ("component", "semantic"...), undefined when the library has no such token. */
  tierOf(path: string): string | undefined;
  /**
   * Where else this token paints: variants of the same component outside the swap ("Size=sm, Variant=primary"), and
   * other components ("IconButton"). Empty lists: nowhere else.
   */
  usedElsewhere(path: string, rebind: Rebind): { variants: string[]; components: string[] };
}

export interface ComponentPushPlan {
  route: PushRoute;
  /** One sentence in designer words: what happens when it is sent. */
  said: string;
  /** Exact token edits: the whole change (token-change), or the part Claude makes too (claude-draft). */
  edits: TokenEdit[];
  /** Why a token swap needs Claude rather than a token change, one sentence each. */
  reasons: string[];
  /** Listed with what to do, never sent. */
  issues: PushIssue[];
  /** Other components an exact token change also repaints (they share the component token): said, for review. */
  alsoChanges: string[];
}

const where = (r: Rebind) => (r.allVariants ? 'every variant' : shortVariants(r.variants.join('; ')));
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** "Radius in neutral sm is 12, not a variable." and the variables that hold 12, to bind one. */
function rawIssue(label: string, r: Rebind, values: UnboundValue[]): PushIssue {
  const matches = [...new Set(values.flatMap((v) => v.matches ?? []))];
  const todo = !matches.length
    ? 'No variable has that value: bind it to one so it follows the library, or create the variable and send it with the variables.'
    : matches.length === 1
      ? `${matches[0]} has that value: bind it so it follows the library.`
      : `${and(matches)} have that value: bind one so it follows the library.`;
  return { what: `${label} is ${and(values.map((v) => v.value))}, not a variable.`, todo, raw: { kind: r.kind, variants: r.variants, values } };
}

/**
 * How a component change from Figma goes back to the library. A token swap is exact when the property was painted by a
 * component token (one variable before, one after), that token paints nothing else, and the new variable is a token
 * the library has: the token then points to the new variable. Anything else that needs code is built by a developer with Claude;
 * what cannot be read with confidence is listed with what to do.
 */
export function planComponentPush(d: ComponentPushDiff, ctx: PushTokenContext): ComponentPushPlan {
  const issues = [...d.unknown];
  const reasons: string[] = [];
  const edits = new Map<string, TokenEdit>();
  const also = new Set<string>();
  for (const r of d.rebinds) {
    const label = `${cap(r.kind)} in ${where(r)}`;
    if (r.raw?.length) {
      issues.push(rawIssue(label, r, r.raw));
      continue;
    }
    if (!r.after.length) {
      issues.push({ what: `${label} is no longer bound to a variable: it uses a raw value.`, todo: 'Bind it to a variable, or create the variable and send it with the variables, then scan again.' });
      continue;
    }
    const missing = r.after.filter((p) => !ctx.tierOf(p));
    if (missing.length) {
      issues.push({ what: `${label} uses ${missing.join(', ')}, a variable the library does not have yet.`, todo: 'Send the variable first (Variables, above), then scan again.' });
      continue;
    }
    if (!r.before.length) {
      reasons.push(`${label} is bound to ${r.after.join(', ')} where code paints nothing: the CSS needs it added.`);
      continue;
    }
    if (r.before.length !== 1 || r.after.length !== 1) {
      reasons.push(`${label} moved from ${r.before.join(', ')} to ${r.after.join(', ')}: several variables on one property, so the CSS needs writing.`);
      continue;
    }
    const [from, to] = [r.before[0]!, r.after[0]!];
    if (ctx.tierOf(from) !== 'component') {
      reasons.push(`Code paints ${r.kind} with ${from} directly, not through a ${d.component} token: the CSS needs to change to ${to}.`);
      continue;
    }
    // Other variants of this component still paint with it: the designer changed only some, so a new token is needed.
    // Other components that share it (IconButton uses button tokens) change with it: said, the review decides.
    const elsewhere = ctx.usedElsewhere(from, r);
    if (elsewhere.variants.length) {
      const v = elsewhere.variants;
      const list = v.length > 3 ? `${shortVariants(v.slice(0, 3).join('; ')).replace(/ and /, ', ')} and ${v.length - 3} more` : shortVariants(v.join('; '));
      reasons.push(`${from} also paints ${list}: pointing it to ${to} would change them too, so it needs a new token for ${where(r)}.`);
      continue;
    }
    for (const c of elsewhere.components) also.add(c);
    const prev = edits.get(from);
    if (prev && prev.value !== `{${to}}`) {
      reasons.push(`${from} moved to two different variables (${String(prev.value).slice(1, -1)} and ${to}): it needs splitting in two.`);
      edits.delete(from);
      continue;
    }
    edits.set(from, { op: 'set', path: from, value: `{${to}}` });
  }
  const list = [...edits.values()];
  if (d.needsCode || reasons.length) {
    return {
      route: 'claude-draft',
      said: `A developer builds it with Claude from what you changed, then a person reviews it.${list.length ? ` ${list.length === 1 ? 'Its token swap goes' : 'Its token swaps go'} with it.` : ''}`,
      edits: list,
      reasons,
      issues,
      alsoChanges: [...also],
    };
  }
  if (list.length) {
    const n = list.length;
    const others = [...also];
    const names = others.length > 3 ? [...others.slice(0, 3), `${others.length - 3} more`] : others;
    const alsoLine = names.length ? ` It also repaints ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}: they use the same token${n === 1 ? '' : 's'}.` : '';
    return { route: 'token-change', said: `Exact, no AI: ${n === 1 ? `${list[0]!.path} points` : `${n} ${d.component} tokens point`} to the new variable${n === 1 ? '' : 's'}, checked for contrast and reviewed like any token change.${alsoLine}`, edits: list, reasons, issues, alsoChanges: others };
  }
  return { route: 'manual', said: issues.length ? 'Fix it in Figma first: nothing is sent until Bridge can read it.' : 'Nothing to send.', edits: [], reasons, issues, alsoChanges: [] };
}

/**
 * Where else a token paints, from component-specs.json (what code gives each component): the variants of `component`
 * outside the swap, and the other components. For tools that read the code, not a Figma file (the MCP server, the CLI).
 */
export function specsUsage(specs: Pick<ComponentSpecsFile, 'components'>, component: string): PushTokenContext['usedElsewhere'] {
  const own = specs.components.find((x) => x.name === component) ?? specs.components.find((x) => x.component === component);
  return (path, r) => {
    const variants: string[] = [];
    const components: string[] = [];
    for (const c of specs.components) {
      for (const v of c.variants) {
        if (!Object.values(v.values).some((fields) => Object.values(fields ?? {}).includes(path))) continue;
        const key = variantKeyOf(v.props);
        if (c === own) {
          if (!r.variants.includes(key)) variants.push(key);
        } else if (!components.includes(c.name)) components.push(c.name);
      }
    }
    return { variants, components };
  };
}

/**
 * The contrast gate for component token swaps. contrast.checks.json lists semantic pairs (action text on action bg);
 * a component token that aliases one side of a pair is checked in its place, against the component token that aliases
 * the other side (button.primary.text on button.primary.bg), else against that other side itself. So pointing
 * button.primary.bg to a pale variable fails the same way the semantic pair would.
 */
export function componentContrastPairs(edits: readonly Pick<TokenEdit, 'path'>[], pairs: readonly ContrastPair[], tokens: { aliasOf(path: string): string | undefined; paths: readonly string[] }): ContrastPair[] {
  const out = new Map<string, ContrastPair>();
  for (const e of edits) {
    const target = tokens.aliasOf(e.path);
    if (!target) continue;
    const group = e.path.split('.')[0]!;
    // The component token in the same component that paints the other side, when there is one.
    const sibling = (other: string) => tokens.paths.find((p) => p !== e.path && p.split('.')[0] === group && tokens.aliasOf(p) === other) ?? other;
    for (const p of pairs) {
      if (p.foreground === target) out.set(`${e.path}|${sibling(p.background)}`, { ...p, foreground: e.path, background: sibling(p.background) });
      if (p.background === target) out.set(`${sibling(p.foreground)}|${e.path}`, { ...p, foreground: sibling(p.foreground), background: e.path });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// The library branch: origin mark, spec file, brief and body

/** Every library branch opened from a Figma component carries this label. */
export const FROM_FIGMA_LABEL = 'from-figma';
/** A Claude draft branch that carries the spec only: no code yet. */
export const WAITING_FOR_CLAUDE_LABEL = 'waiting-for-claude';
/** A Claude draft branch once Claude wrote the code: a person reviews it. */
export const DRAFTED_BY_CLAUDE_LABEL = 'drafted-by-claude';
/** Where a Claude draft branch keeps the spec it was opened with. */
export const FIGMA_SPEC_DIR = '.bridge/figma';

const ORIGIN_MARK = 'bridge-from-figma';

export type FigmaOriginStatus = 'spec' | 'drafted';

/** What the library branch remembers about where it came from: the Figma component and how it was routed. */
export interface FigmaOrigin {
  component: string;
  figmaName: string;
  route: Exclude<PushRoute, 'manual'>;
  kind: RequestKind;
  nodeId?: string | undefined;
  fileKey?: string | undefined;
  url?: string | undefined;
  /** Claude draft branches: the spec file, and whether Claude wrote the code yet. */
  spec?: string | undefined;
  status?: FigmaOriginStatus | undefined;
  requestedBy?: string | undefined;
}

const hidden = (data: unknown) => `<!-- ${ORIGIN_MARK} ${JSON.stringify(data).replace(/-->/g, '--\\u003e')} -->`;

export function parseFigmaOrigin(body: string | null | undefined): FigmaOrigin | undefined {
  if (!body) return undefined;
  const m = new RegExp(`<!-- ${ORIGIN_MARK} (\\{[\\s\\S]*?\\}) -->`).exec(body);
  if (!m) return undefined;
  try {
    const o = JSON.parse(m[1]!) as FigmaOrigin;
    return typeof o.component === 'string' && (o.route === 'token-change' || o.route === 'claude-draft') ? o : undefined;
  } catch {
    return undefined;
  }
}

/** The "From Figma" lines people read on GitHub, then the hidden block tools read. */
export function figmaOriginSection(o: FigmaOrigin): string {
  const design = o.url ? `[${o.figmaName}](${o.url})` : `"${o.figmaName}"`;
  const who = o.requestedBy ? ` by @${o.requestedBy}` : '';
  const status =
    o.route === 'token-change'
      ? 'Exact token change, no AI: Bridge read the token swap from the Figma component.'
      : o.status === 'drafted'
        ? '**Drafted with Claude** from the Figma spec. A person reviews it before it ships.'
        : `**Waiting for a developer:** this branch carries the spec only, as a request. A developer builds the code here with Claude (\`bridge_get_figma_change\`, or \`bridge figma show <number>\`), then it is labelled ${DRAFTED_BY_CLAUDE_LABEL}.`;
  return [`**From Figma:** ${design}${who}. Once it ships, a pull in the Bridge Figma plugin rebuilds the component from this code.`, '', status, '', hidden(o)].join('\n');
}

/** The body with the "From Figma" section first (replacing an earlier one). */
export function withFigmaOrigin(body: string | null | undefined, o: FigmaOrigin): string {
  let b = (body ?? '').trim();
  const at = b.indexOf('**From Figma:**');
  const mark = b.indexOf(`<!-- ${ORIGIN_MARK} `);
  if (at >= 0 && mark > at) {
    const end = b.indexOf('-->', mark);
    b = `${b.slice(0, at)}${b.slice(end + 3)}`.trim();
  }
  return `${figmaOriginSection(o)}${b ? `\n\n${b}` : ''}`;
}

export const figmaSpecSlug = (d: Pick<ComponentPushDiff, 'component' | 'title'>) => slugify(`${d.component} ${d.title}`, 48) || 'component-change';

/** The spec file of a Claude draft branch. */
export const figmaSpecPath = (d: Pick<ComponentPushDiff, 'component' | 'title'>) => `${FIGMA_SPEC_DIR}/${figmaSpecSlug(d)}.json`;

const kindLabel = (k: RequestKind) => REQUEST_KINDS.find((x) => x.value === k)?.label ?? 'Change';

/** The structured diff as the spec file stores it (stable key order, two-space JSON). */
export function formatFigmaSpec(d: ComponentPushDiff, plan: Pick<ComponentPushPlan, 'edits' | 'reasons' | 'issues'>): string {
  return `${JSON.stringify({ ...d, tokenEdits: plan.edits, reasons: plan.reasons, unknown: plan.issues }, null, 2)}\n`;
}

/** Reads a spec file back; undefined when it is not one. */
export function parseFigmaSpec(text: string | null | undefined): (ComponentPushDiff & { tokenEdits?: TokenEdit[]; reasons?: string[] }) | undefined {
  if (!text) return undefined;
  try {
    const s = JSON.parse(text) as ComponentPushDiff & { tokenEdits?: TokenEdit[]; reasons?: string[] };
    return s && s.v === 1 && typeof s.component === 'string' && Array.isArray(s.changes) ? s : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What Claude gets to draft the code on the branch (MCP `bridge_get_figma_change`, CLI `bridge figma show`): the change,
 * the spec, the exact token swaps to make too, the rules, and how to say it is drafted.
 */
export function figmaDraftBrief(
  d: ComponentPushDiff & { tokenEdits?: TokenEdit[] | undefined; reasons?: string[] | undefined },
  ctx: { pr: number; branch: string; specPath: string; componentsDir?: string | undefined; agentsFile?: string | undefined } | { suggestion: true; specPath: string; componentsDir?: string | undefined; agentsFile?: string | undefined },
): string {
  const dir = `${(ctx.componentsDir ?? 'packages/react/src/components').replace(/\/+$/, '')}/${d.component}`;
  // A suggestion has no branch yet: the developer starts one by applying it, and the pull request closes the issue.
  const suggested = 'suggestion' in ctx;
  const variants = Object.entries(d.variantAxes).map(([axis, values]) => `${axis}: ${values.join(', ')}`);
  const props = d.properties.filter((p) => p.type !== 'VARIANT').map((p) => `${p.name} (${p.type.toLowerCase().replace('_', ' ')}, default ${p.default || 'empty'})`);
  return [
    suggested
      ? 'Draft the code for a component change made in Figma, sent as a Bridge suggestion (this issue).'
      : `Draft the code for a component change made in Figma, on the library branch ${ctx.branch} (draft pull request #${ctx.pr}).`,
    '',
    d.coded ? `Component: ${d.component} (${dir})` : `New component: ${d.component} (create ${dir})`,
    `Kind: ${kindLabel(d.kind)}`,
    `Change: ${d.title}`,
    ...(d.line?.trim() ? [`What changes: ${d.line.trim()}`] : []),
    '',
    d.summary.trim(),
    '',
    ...(d.changes.length ? ['Changes in Figma:', ...d.changes.map((c) => `- ${c.field}: ${c.before ?? '(none)'} -> ${c.after ?? '(removed)'}`), ''] : []),
    ...(variants.length ? ['Variant matrix in Figma:', ...variants.map((v) => `- ${v}`), ''] : []),
    ...(props.length ? ['Properties in Figma:', ...props.map((p) => `- ${p}`), ''] : []),
    ...(d.tokenEdits?.length ? ['Token swaps to make too (exact, with bridge_propose_token_change on this branch or by hand in the token files):', ...d.tokenEdits.map((e) => `- ${e.path} -> ${String(e.value)}`), ''] : []),
    ...(d.reasons?.length ? ['Why this needs code:', ...d.reasons.map((r) => `- ${r}`), ''] : []),
    `Spec: ${ctx.specPath} ${suggested ? 'in the suggestion' : 'on the branch'} has the bound variables of every variant (token paths), the layers of every variant and what code gave Figma before.`,
    ...(d.figma?.url ? [`Design: ${d.figma.url}`] : []),
    ...(suggested && d.figma?.fileKey && d.figma.nodeId
      ? [`Read the design straight from Figma: Figma MCP get_design_context { fileKey: "${d.figma.fileKey}", nodeId: "${d.figma.nodeId}" }${d.figma.before?.nodeId ? ` (before: node ${d.figma.before.nodeId})` : ''}, or the REST API GET https://api.figma.com/v1/files/${d.figma.fileKey}/nodes?ids=${encodeURIComponent(d.figma.nodeId)}.`]
      : []),
    ...(d.images?.length ? ['Screenshot:', ...d.images.map((u) => `- ${u}`)] : []),
    '',
    'Steps:',
    'suggestion' in ctx ? '1. Apply the suggestion on a new branch: bridge apply <this issue number> (it writes the spec file), or start a branch from the default branch.' : `1. git fetch origin && git checkout ${ctx.branch}`,
    `2. Write the change in ${dir}: the TSX on Base UI, the CSS module with tokens only (the bound variables of the spec, as token paths), the stories (examples), docs.json and a changeset. Follow ${ctx.agentsFile ?? 'AGENTS.md'}.`,
    '3. Run npm run specs so component-specs.json matches the code, then npm test.',
    'suggestion' in ctx
      ? '4. Commit, push and open a pull request that says "Closes #<this issue number>", so the suggestion closes when it ships. A person reviews it.'
      : `4. Commit and push to ${ctx.branch}, then call bridge_mark_figma_change_drafted { pr: ${ctx.pr} } (CLI: bridge figma drafted ${ctx.pr}). The pull request is then ready for review, labelled ${DRAFTED_BY_CLAUDE_LABEL}, and a person reviews it.`,
    '',
    'Rules:',
    '- Never invent a token or a value: use the variables the spec lists. A value the library lacks is a token change, said in the pull request.',
    '- Keep every existing variant and prop unchanged unless the spec changes it.',
    `- If the spec is unclear, comment on the ${suggested ? 'suggestion' : 'pull request'} instead of guessing.`,
  ].join('\n');
}

/** The pull request body of a Claude draft branch: the origin, the change, the rows and the spec. */
export function figmaDraftBody(d: ComponentPushDiff, plan: Pick<ComponentPushPlan, 'edits' | 'reasons' | 'issues'>, o: FigmaOrigin): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = d.changes.length ? ['| What | Code now | In Figma |', '| --- | --- | --- |', ...d.changes.map((c) => `| ${cell(c.field)} | ${cell(c.before ?? '')} | ${cell(c.after ?? '')} |`), ''] : [];
  return withFigmaOrigin(
    [
      `## ${d.coded ? `${kindLabel(d.kind)} for ${d.component}` : `New component: ${d.component}`}`,
      '',
      d.summary.trim(),
      '',
      ...(d.line?.trim() ? [`**What changes:** ${d.line.trim()}`, ''] : []),
      ...rows,
      ...(d.images?.length ? [...d.images.map((u, i) => `![${d.component} in Figma ${i + 1}](${u})`), ''] : []),
      ...(plan.edits.length ? ['**Token swaps to make too:**', ...plan.edits.map((e) => `- \`${e.path}\` -> \`${String(e.value)}\``), ''] : []),
      ...(plan.reasons.length ? ['**Why this needs code:**', ...plan.reasons.map((r) => `- ${r}`), ''] : []),
      ...(plan.issues.length ? ['**Left in Figma (the designer fixes these first):**', ...plan.issues.map((i) => `- ${i.what} ${i.todo}`), ''] : []),
      `**Spec:** \`${o.spec ?? figmaSpecPath(d)}\` (variant matrix, properties, bound variables and layers of every variant).`,
    ].join('\n'),
    o,
  );
}

/** The title of a library branch opened from Figma: "Button: add a lg size". */
export const figmaBranchTitle = (d: Pick<ComponentPushDiff, 'component' | 'title'>) => requestIssueTitle(d);

// ---------------------------------------------------------------------------------------------------------------
// Where a library branch from Figma stands

export type FigmaPushStatusKey = 'waiting-for-claude' | 'drafted' | 'in-review' | 'shipped' | 'closed';

export interface FigmaPushStatus {
  key: FigmaPushStatusKey;
  /** "Waiting for a developer", "Shipped". */
  label: string;
  /** One sentence for the designer. */
  sentence: string;
  /** The Figma component should be rebuilt from code (the branch shipped or was closed). */
  rebuild: boolean;
}

/** Where a library branch opened from Figma stands, from its state and labels. */
export function figmaPushStatus(x: { state: string; draft?: boolean | undefined; labels?: readonly string[] | undefined; route?: PushRoute | undefined }): FigmaPushStatus {
  const labels = x.labels ?? [];
  if (x.state === 'merged') return { key: 'shipped', label: 'Shipped', sentence: 'It shipped. Pull to rebuild the component from the reviewed code.', rebuild: true };
  if (x.state !== 'open') return { key: 'closed', label: 'Closed', sentence: 'The library closed it without shipping. Pull to bring the component back to the code.', rebuild: true };
  if (labels.includes(WAITING_FOR_CLAUDE_LABEL)) return { key: 'waiting-for-claude', label: 'Waiting for a developer', sentence: 'A developer builds it with Claude from its spec, then a person reviews it.', rebuild: false };
  if (labels.includes(DRAFTED_BY_CLAUDE_LABEL)) return { key: 'drafted', label: 'Drafted with Claude', sentence: 'The code is drafted. A person reviews it before it ships.', rebuild: false };
  return { key: 'in-review', label: 'In review', sentence: x.route === 'token-change' ? 'Owners review the token change.' : 'Owners review it.', rebuild: false };
}
