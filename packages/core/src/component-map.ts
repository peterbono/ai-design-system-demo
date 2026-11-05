// The component map (bridge.components.json, at the design system repo root): for each Library component, its Figma
// component and its code. It is a repository file, reviewed like any change: Claude proposes entries
// (bridge_propose_component_map) from what Bridge knows about the Library and what the team's Figma file holds, a
// person approves them. Tokens already carry a stable Figma <-> code identity (id-map.ts); before this file,
// components were matched by name only.
//
//   {
//     "version": 1,
//     "components": {
//       "Button": {
//         "figma": { "file": "<file key>", "key": "<component set key>", "node": "12:34", "name": "Button",
//                    "properties": { "Size": { "prop": "size", "values": { "Small": "sm" } } } },
//         "code": { "import": { "package": "@acme/react", "export": "Button" } },
//         "stories": ["actions-button--primary"]
//       }
//     }
//   }
//
// The component id is the Library name, as bridge_list_components gives it. Pure and browser safe.

import { figmaFileUrl, parseFigmaFile } from './figma-file';

/** File name at the design system repo root, next to bridge.config.json. */
export const COMPONENT_MAP_FILE = 'bridge.components.json';
export const COMPONENT_MAP_VERSION = 1;

export type ComponentMapValue = string | number | boolean;

/** How one Figma component property reads in code: the prop it sets and, for variants, each value's code value. */
export interface ComponentMapProperty {
  prop: string;
  values?: Record<string, ComponentMapValue> | undefined;
}

export interface ComponentMapFigma {
  /** The Figma file key (or a link to the file). */
  file: string;
  /** The key of the component, or of the component set for a component with variants. */
  key?: string | undefined;
  /** The node id in that file ("12:34"), for a link that opens on it. */
  node?: string | undefined;
  /** The name in Figma, when it differs or to show it. Absent: the component id. */
  name?: string | undefined;
  /** Figma property name ("Size", "Label#12:0") -> the code prop. */
  properties?: Record<string, ComponentMapProperty> | undefined;
}

export interface ComponentMapCode {
  /** Where it is imported from: `import { <export> } from '<package>'`. */
  import: { package: string; export: string };
  /** Code props the map knows, when it lists them. */
  props?: string[] | undefined;
}

export interface ComponentMapEntry {
  figma?: ComponentMapFigma | undefined;
  code?: ComponentMapCode | undefined;
  /** Storybook story ids that show it. */
  stories?: string[] | undefined;
}

export interface ComponentMapFile {
  $schema?: string | undefined;
  version: typeof COMPONENT_MAP_VERSION;
  components: Record<string, ComponentMapEntry>;
}

export class ComponentMapError extends Error {
  constructor(readonly problems: string[]) {
    super(`${COMPONENT_MAP_FILE}: ${problems.join('; ')}`);
    this.name = 'ComponentMapError';
  }
}

export const emptyComponentMap = (): ComponentMapFile => ({ version: COMPONENT_MAP_VERSION, components: {} });

// ---------------------------------------------------------------------------------------------
// Validation

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const plain = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const NODE = /^I?\d+[:-]\d+(;\d+[:-]\d+)*$/;
const ENTRY_KEYS = ['figma', 'code', 'stories'];
const FIGMA_KEYS = ['file', 'key', 'node', 'name', 'properties'];
const CODE_KEYS = ['import', 'props'];

function figmaProblems(f: unknown, at: (why: string) => void) {
  if (!isObj(f)) return at('figma must be an object with file and key (or node)');
  for (const k of Object.keys(f)) if (!FIGMA_KEYS.includes(k)) at(`figma.${k} is not known (${FIGMA_KEYS.join(', ')})`);
  if (!isText(f.file)) at('figma.file is missing: the key of the Figma file (the part after /design/ in its link)');
  else if (!parseFigmaFile(f.file)) at(`figma.file "${f.file}" is not a Figma file key or link`);
  if (f.key === undefined && f.node === undefined) at('figma needs key (the component or component set key) or node (its node id)');
  if (f.key !== undefined && !isText(f.key)) at('figma.key must be a text');
  if (f.node !== undefined && !(isText(f.node) && NODE.test(f.node.trim()))) at('figma.node must be a node id like "12:34"');
  if (f.name !== undefined && !isText(f.name)) at('figma.name must be a text');
  if (f.properties === undefined) return;
  if (!isObj(f.properties)) return at('figma.properties maps Figma property names to { "prop", "values"? }');
  for (const [name, p] of Object.entries(f.properties)) {
    const here = (why: string) => at(`figma.properties "${name}": ${why}`);
    if (!isObj(p)) {
      here('must be { "prop", "values"? }');
      continue;
    }
    for (const k of Object.keys(p)) if (k !== 'prop' && k !== 'values') here(`${k} is not known (prop, values)`);
    if (!isText(p.prop)) here('prop is missing: the code prop it sets');
    if (p.values !== undefined && (!isObj(p.values) || !Object.values(p.values).every(plain))) here('values maps each Figma value to a code value (text, number or true/false)');
  }
}

function codeProblems(c: unknown, at: (why: string) => void) {
  if (!isObj(c)) return at('code must be an object with import');
  for (const k of Object.keys(c)) if (!CODE_KEYS.includes(k)) at(`code.${k} is not known (${CODE_KEYS.join(', ')})`);
  const i = c.import;
  if (!isObj(i) || !isText(i.package) || !isText(i.export)) at('code.import must be { "package", "export" }, as in import { Button } from "@acme/react"');
  else for (const k of Object.keys(i)) if (k !== 'package' && k !== 'export') at(`code.import.${k} is not known (package, export)`);
  if (c.props !== undefined && !(Array.isArray(c.props) && c.props.every(isText))) at('code.props must be a list of prop names');
}

/** Every problem in a component map, in plain words (empty when it is valid). */
export function validateComponentMap(data: unknown): string[] {
  const out: string[] = [];
  if (!isObj(data)) return ['expected an object with version and components'];
  if (data.version !== COMPONENT_MAP_VERSION) out.push(`version ${String(data.version)} is not supported (expected ${COMPONENT_MAP_VERSION})`);
  for (const k of Object.keys(data)) if (!['$schema', 'version', 'components'].includes(k)) out.push(`${k} is not known (version, components)`);
  if (!isObj(data.components)) return [...out, 'components must map each Library component name to its entry'];
  const seen = new Map<string, string>();
  for (const [id, e] of Object.entries(data.components)) {
    const at = (why: string) => out.push(`${id}: ${why}`);
    if (!id.trim()) {
      out.push('a component has an empty name');
      continue;
    }
    const lower = id.toLowerCase();
    if (seen.has(lower)) at(`listed twice (also as ${seen.get(lower)})`);
    else seen.set(lower, id);
    if (!isObj(e)) {
      at('must be an object with figma, code or stories');
      continue;
    }
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) at(`${k} is not known (${ENTRY_KEYS.join(', ')})`);
    if (e.figma !== undefined) figmaProblems(e.figma, at);
    if (e.code !== undefined) codeProblems(e.code, at);
    if (e.stories !== undefined && !(Array.isArray(e.stories) && e.stories.every(isText))) at('stories must be a list of story ids');
  }
  return out;
}

/** Reads bridge.components.json (text or parsed JSON); throws ComponentMapError with every problem. */
export function parseComponentMap(input: string | unknown): ComponentMapFile {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new ComponentMapError([`not valid JSON (${(e as Error).message})`]);
    }
  }
  const problems = validateComponentMap(data);
  if (problems.length) throw new ComponentMapError(problems);
  return data as ComponentMapFile;
}

/** The map from the file's text, never throwing: null and no problem when there is no file. */
export function readComponentMap(text: string | null | undefined): { map: ComponentMapFile | null; problems: string[] } {
  if (text === null || text === undefined) return { map: null, problems: [] };
  try {
    return { map: parseComponentMap(text), problems: [] };
  } catch (e) {
    return { map: null, problems: e instanceof ComponentMapError ? e.problems : [(e as Error).message] };
  }
}

/** The file's text: two-space JSON, components in name order, a final newline. */
export function serializeComponentMap(map: ComponentMapFile): string {
  const components = Object.fromEntries(Object.entries(map.components).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ ...(map.$schema ? { $schema: map.$schema } : {}), version: COMPONENT_MAP_VERSION, components }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------
// Reading

/** One component's entry, the name matched without case. */
export function componentMapEntry(map: ComponentMapFile | null | undefined, name: string): ComponentMapEntry | undefined {
  const id = componentMapId(map, name);
  return id === undefined ? undefined : map!.components[id];
}

/** The id a component has in the map (its Library name as the file writes it), matched without case. */
export function componentMapId(map: ComponentMapFile | null | undefined, name: string): string | undefined {
  if (!map) return undefined;
  if (map.components[name]) return name;
  const lower = name.toLowerCase();
  return Object.keys(map.components).find((k) => k.toLowerCase() === lower);
}

export interface FigmaLink {
  /** The name in Figma. */
  name: string;
  /** Opens the component in its file (the file when no node is known). */
  url: string;
  file: string;
  key?: string | undefined;
  node?: string | undefined;
}

/** Where a Library component is in Figma, null when the map does not link it. */
export function figmaLinkOf(map: ComponentMapFile | null | undefined, name: string): FigmaLink | null {
  const id = componentMapId(map, name);
  const f = id === undefined ? undefined : map!.components[id]!.figma;
  const file = f ? parseFigmaFile(f.file) : null;
  if (!f || !file) return null;
  return { name: f.name?.trim() || id!, url: figmaFileUrl(file.key, f.node), file: file.key, ...(f.key ? { key: f.key } : {}), ...(f.node ? { node: f.node } : {}) };
}

/** What an agent reads for a component with no Figma link. */
export const NOT_LINKED_TO_FIGMA = 'not linked to Figma yet';

export interface ComponentMapReport {
  /** The file is there. */
  present: boolean;
  /** Problems that make the file invalid (empty when valid or absent). */
  problems: string[];
  /** Library components linked to Figma. */
  linked: string[];
  /** Library components with no Figma link. Never a failure: linking is gradual. */
  unmapped: string[];
  /** Entries that name no Library component (renamed or removed). */
  unknown: string[];
}

/** How the map covers the Library: what `bridge check` reports. */
export function componentMapReport(text: string | null | undefined, library: readonly string[]): ComponentMapReport {
  const { map, problems } = readComponentMap(text);
  const lib = new Map(library.map((n) => [n.toLowerCase(), n]));
  const linked: string[] = [];
  const unmapped: string[] = [];
  for (const n of library) (figmaLinkOf(map, n) ? linked : unmapped).push(n);
  const unknown = map ? Object.keys(map.components).filter((k) => !lib.has(k.toLowerCase())) : [];
  return { present: text !== null && text !== undefined, problems, linked, unmapped, unknown };
}

/** The report in lines for a terminal. */
export function componentMapLines(r: ComponentMapReport): string[] {
  if (!r.present) return [`component map: no ${COMPONENT_MAP_FILE} yet, ${r.unmapped.length} components not linked to Figma (ask Claude to propose the map)`];
  if (r.problems.length) return [`component map: ${COMPONENT_MAP_FILE} is invalid`, ...r.problems.map((p) => `  error  ${p}`)];
  const total = r.linked.length + r.unmapped.length;
  return [
    `component map: ${r.linked.length} of ${total} components linked to Figma`,
    ...(r.unmapped.length ? [`  not linked yet: ${r.unmapped.join(', ')}`] : []),
    ...r.unknown.map((n) => `  warn   ${n} is in ${COMPONENT_MAP_FILE} but not in the Library (renamed or removed?)`),
  ];
}

// ---------------------------------------------------------------------------------------------
// Proposing

/** A Library component as Bridge knows it: its props (from TypeScript) and where it is imported from. */
export interface LibraryComponentInput {
  name: string;
  props?: { name: string; type?: string | undefined; values?: string[] | undefined }[] | undefined;
  import?: { package: string; export: string } | undefined;
}

/** One Figma property as the Figma connector or the plugin reads it (componentPropertyDefinitions). */
export interface FigmaPropertyInput {
  type?: string | undefined;
  /** Variant options. `variantOptions` (the Plugin API name) is read too. */
  values?: string[] | undefined;
  variantOptions?: string[] | undefined;
}

/** One Figma component or component set, as Claude reads it through the Figma connector. */
export interface FigmaComponentInput {
  name: string;
  key?: string | undefined;
  node?: string | undefined;
  /** The file it lives in. Absent: the file of the call. */
  file?: string | undefined;
  /** COMPONENT or COMPONENT_SET. */
  type?: string | undefined;
  properties?: Record<string, FigmaPropertyInput> | undefined;
}

export interface ProposedLink {
  component: string;
  entry: ComponentMapEntry;
  /** What the match rests on. */
  matchedBy: 'name' | 'name and properties';
  /** Figma properties or values with no code prop of the same name: left out, never guessed. */
  unmappedProperties: string[];
}

export interface AmbiguousLink {
  component: string;
  candidates: { name: string; key?: string | undefined; node?: string | undefined }[];
  why: string;
}

export interface ComponentMapProposal {
  proposed: ProposedLink[];
  unmatched: {
    /** Library components with no Figma component of the same name. */
    library: string[];
    /** Figma components with no Library component of the same name. */
    figma: string[];
  };
  ambiguous: AmbiguousLink[];
}

/** "Forms/Text input", "❖ TextInput", "text-input" -> "textinput". */
export const matchName = (s: string): string =>
  (s.split('/').pop() ?? s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Figma appends "#12:0" to the name of a boolean, text or instance property. */
const propName = (s: string) => s.replace(/#\d+:\d+$/, '').trim();
const BOOL: Record<string, boolean> = { true: true, false: false, yes: true, no: false, on: true, off: false };
const isBoolType = (t: string | undefined) => !!t && /^(boolean|true \| false|false \| true)$/.test(t.trim());

/** A Figma component that is not a whole component: a variant ("Size=sm, State=hover") or a private part (".base"). */
const notAComponent = (c: FigmaComponentInput) => c.name.includes('=') || /^[._]/.test(c.name.split('/').pop()!.trim());

function mapProperties(lib: LibraryComponentInput, fig: FigmaComponentInput): { properties: Record<string, ComponentMapProperty>; unmapped: string[] } {
  const properties: Record<string, ComponentMapProperty> = {};
  const unmapped: string[] = [];
  const props = new Map((lib.props ?? []).map((p) => [matchName(p.name), p]));
  for (const [rawName, def] of Object.entries(fig.properties ?? {})) {
    const name = propName(rawName);
    const prop = props.get(matchName(name));
    if (!prop) {
      unmapped.push(name);
      continue;
    }
    const options = def.values ?? def.variantOptions ?? [];
    const type = (def.type ?? '').toUpperCase();
    if (type === 'VARIANT' || (options.length && type !== 'BOOLEAN')) {
      const values: Record<string, ComponentMapValue> = {};
      const codeValues = new Map((prop.values ?? []).map((v) => [matchName(v), v]));
      for (const o of options) {
        const b = BOOL[o.trim().toLowerCase()];
        const code = codeValues.get(matchName(o)) ?? (isBoolType(prop.type) && b !== undefined ? b : undefined);
        if (code === undefined) unmapped.push(`${name}=${o}`);
        else values[o] = code;
      }
      if (!Object.keys(values).length && options.length) {
        unmapped.splice(unmapped.length - options.length, options.length, name);
        continue;
      }
      properties[rawName] = { prop: prop.name, ...(Object.keys(values).length ? { values } : {}) };
    } else properties[rawName] = { prop: prop.name };
  }
  return { properties, unmapped };
}

/**
 * Map entries proposed from the Library and the Figma components the caller read. Matches by name (case, spaces,
 * dashes and the page path ignored), then by variant properties when several Figma components share a name; a tie
 * stays ambiguous, never guessed. Variants ("Size=sm") and private parts (".base", "_icon") are not components.
 * Properties map only to a code prop of the same name, values only to a code value of the same name.
 */
export function proposeComponentMap(input: { library: readonly LibraryComponentInput[]; figma: readonly FigmaComponentInput[]; file?: string | undefined }): ComponentMapProposal {
  const figma = input.figma.filter((c) => c.name?.trim() && !notAComponent(c));
  const byName = new Map<string, FigmaComponentInput[]>();
  for (const c of figma) {
    const k = matchName(c.name);
    if (!k) continue;
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(c);
  }
  const proposed: ProposedLink[] = [];
  const ambiguous: AmbiguousLink[] = [];
  const unmatchedLibrary: string[] = [];
  const used = new Set<FigmaComponentInput>();
  const candidate = (c: FigmaComponentInput) => ({ name: c.name, ...(c.key ? { key: c.key } : {}), ...(c.node ? { node: c.node } : {}) });
  for (const lib of input.library) {
    const found = byName.get(matchName(lib.name)) ?? [];
    for (const c of found) used.add(c);
    if (!found.length) {
      unmatchedLibrary.push(lib.name);
      continue;
    }
    let pick: FigmaComponentInput | undefined;
    let by: ProposedLink['matchedBy'] = 'name';
    if (found.length === 1) pick = found[0];
    else {
      const scored = found.map((c) => ({ c, score: Object.keys(mapProperties(lib, c).properties).length })).sort((a, b) => b.score - a.score);
      if (scored[0]!.score > 0 && scored[0]!.score > scored[1]!.score) {
        pick = scored[0]!.c;
        by = 'name and properties';
      } else {
        ambiguous.push({ component: lib.name, candidates: found.map(candidate), why: `${found.length} Figma components are named like ${lib.name} and their properties do not tell them apart` });
        continue;
      }
    }
    const fileRef = parseFigmaFile(pick!.file ?? input.file);
    if (!fileRef || (!pick!.key && !pick!.node)) {
      ambiguous.push({ component: lib.name, candidates: [candidate(pick!)], why: !fileRef ? 'the Figma file is not known: pass the file' : 'the Figma component has no key or node id' });
      continue;
    }
    const { properties, unmapped } = mapProperties(lib, pick!);
    if (by === 'name' && Object.keys(properties).length) by = 'name and properties';
    const figmaSide: ComponentMapFigma = {
      file: fileRef.key,
      ...(pick!.key ? { key: pick!.key } : {}),
      ...(pick!.node ? { node: pick!.node.replace(/-/g, ':') } : {}),
      ...(pick!.name.split('/').pop()!.trim() !== lib.name ? { name: pick!.name.split('/').pop()!.trim() } : {}),
      ...(Object.keys(properties).length ? { properties } : {}),
    };
    proposed.push({ component: lib.name, entry: { figma: figmaSide, ...(lib.import ? { code: { import: lib.import } } : {}) }, matchedBy: by, unmappedProperties: unmapped });
  }
  const figmaOnly = [...new Set(figma.filter((c) => !used.has(c)).map((c) => c.name))];
  return { proposed, unmatched: { library: unmatchedLibrary, figma: figmaOnly }, ambiguous };
}

/**
 * The map with the proposed links added. A component already linked to Figma keeps its link (a person changes it in
 * review); one without a code side gets the proposal's.
 */
export function mergeComponentMap(existing: ComponentMapFile | null | undefined, proposed: readonly ProposedLink[]): { map: ComponentMapFile; added: string[]; kept: string[] } {
  const map: ComponentMapFile = existing ? (JSON.parse(JSON.stringify(existing)) as ComponentMapFile) : emptyComponentMap();
  const added: string[] = [];
  const kept: string[] = [];
  for (const p of proposed) {
    const key = Object.keys(map.components).find((k) => k.toLowerCase() === p.component.toLowerCase()) ?? p.component;
    const now = map.components[key];
    if (now?.figma) {
      kept.push(key);
      continue;
    }
    map.components[key] = { ...now, figma: p.entry.figma, ...(now?.code ?? p.entry.code ? { code: now?.code ?? p.entry.code } : {}) };
    added.push(key);
  }
  return { map, added, kept };
}

/** The reviewers' description of a proposed map: what links, what stays out and why. No em dash. */
export function componentMapProposalBody(p: ComponentMapProposal, merged: { added: string[]; kept: string[] }, opts: { fileUrl?: string | undefined; tool?: string | undefined } = {}): string {
  const by = new Map(p.proposed.map((x) => [x.component, x]));
  const lines = [
    '## Link Library components to Figma',
    '',
    `Adds ${merged.added.length} Figma link${merged.added.length === 1 ? '' : 's'} to \`${COMPONENT_MAP_FILE}\`${opts.fileUrl ? ` from [the team's Figma file](${opts.fileUrl})` : ''}. Matched by name, then by variant properties; nothing ambiguous is guessed.`,
    '',
  ];
  if (merged.added.length) {
    lines.push('| Component | In Figma | Matched by | Left out |', '| --- | --- | --- | --- |');
    for (const n of merged.added) {
      const x = by.get(n) ?? [...by.values()].find((v) => v.component.toLowerCase() === n.toLowerCase());
      if (!x) continue;
      lines.push(`| ${n} | ${x.entry.figma?.name ?? n} | ${x.matchedBy} | ${x.unmappedProperties.length ? x.unmappedProperties.join(', ') : 'nothing'} |`);
    }
    lines.push('');
  }
  if (merged.kept.length) lines.push(`Already linked, kept as they are: ${merged.kept.join(', ')}.`, '');
  if (p.ambiguous.length) {
    lines.push('**Not linked, more than one match:**', '');
    for (const a of p.ambiguous) lines.push(`- ${a.component}: ${a.why} (${a.candidates.map((c) => c.name).join(', ')}).`);
    lines.push('');
  }
  if (p.unmatched.library.length) lines.push(`**No Figma component with the same name:** ${p.unmatched.library.join(', ')}.`, '');
  if (p.unmatched.figma.length) lines.push(`**In Figma only:** ${p.unmatched.figma.join(', ')}.`, '');
  lines.push('A person checks each link opens the right component, then approves.', '', '---', `Proposed${opts.tool ? ` through ${opts.tool}` : ''}.`);
  return lines.join('\n');
}
