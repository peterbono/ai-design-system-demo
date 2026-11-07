import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_MAP_FILE,
  componentMapLines,
  componentMapProposalBody,
  componentMapReport,
  ConfigError,
  figmaFileOf,
  figmaFileProblem,
  figmaLinkOf,
  loadConfig,
  matchName,
  mergeComponentMap,
  parseComponentMap,
  parseFigmaFile,
  proposeComponentMap,
  readComponentMap,
  serializeComponentMap,
  toConfigJson,
  validateComponentMap,
  type FigmaComponentInput,
  type LibraryComponentInput,
} from '../src/index';

const FILE = 'AbCdEf0123456789XyZ';
const button = { figma: { file: FILE, key: 'k-button', node: '12:34', properties: { Size: { prop: 'size', values: { Small: 'sm' } } } }, code: { import: { package: '@acme/react', export: 'Button' } } };

describe('the team Figma file', () => {
  it('reads a link (design, file, branch) or a key, and refuses anything else', () => {
    expect(parseFigmaFile(`https://www.figma.com/design/${FILE}/Library?node-id=1-2`)).toEqual({ key: FILE, url: `https://www.figma.com/design/${FILE}/` });
    expect(parseFigmaFile(`figma.com/file/${FILE}/Old`)?.key).toBe(FILE);
    expect(parseFigmaFile(`https://www.figma.com/design/${FILE}/branch/BrAnCh0123456/Library`)?.key).toBe('BrAnCh0123456');
    expect(parseFigmaFile(FILE)?.key).toBe(FILE);
    for (const bad of ['', 'not a link', 'https://example.com/design/AbCdEf0123456789/x', 'https://www.figma.com/community/file/123']) expect(parseFigmaFile(bad), bad).toBeNull();
    expect(figmaFileProblem('')).toBe('Paste the link of your Figma file.');
    expect(figmaFileProblem('hello')).toMatch(/^Paste a link to a Figma file/);
    expect(figmaFileProblem(FILE)).toBeNull();
  });

  it('is an optional figma.file of bridge.config.json, validated and written back', () => {
    const base = { repo: 'acme/ds' };
    expect(loadConfig(base).figma).toBeUndefined();
    const c = loadConfig({ ...base, figma: { file: ` https://www.figma.com/design/${FILE}/Library ` } });
    expect(c.figma).toEqual({ file: `https://www.figma.com/design/${FILE}/Library` });
    expect(figmaFileOf(c)?.key).toBe(FILE);
    expect(toConfigJson(c).figma).toEqual(c.figma);
    expect(() => loadConfig({ ...base, figma: { file: 'nope' } })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, figma: 'x' })).toThrow(/"figma" must be \{ "file" \}/);
    expect(loadConfig({ ...base, figma: { file: FILE, page: 1 } }).figma?.file).toBe(FILE);
  });
});

describe('bridge.components.json', () => {
  it('parses a valid map and reads each link', () => {
    const map = parseComponentMap({ version: 1, components: { Button: button, Card: { code: { import: { package: '@acme/react', export: 'Card' } } } } });
    expect(figmaLinkOf(map, 'button')).toEqual({ name: 'Button', url: `https://www.figma.com/design/${FILE}/?node-id=12-34`, file: FILE, key: 'k-button', node: '12:34' });
    expect(figmaLinkOf(map, 'Card')).toBeNull();
    expect(figmaLinkOf(null, 'Card')).toBeNull();
  });

  it('says every problem in plain words', () => {
    const problems = validateComponentMap({
      version: 2,
      extra: true,
      components: {
        Button: { figma: { file: 'x' }, code: { import: { package: '@acme/react' } }, story: [] },
        button: {},
        Tabs: { figma: { file: FILE, node: 'twelve', properties: { Size: { values: { S: 's' } } } }, stories: [3] },
      },
    });
    expect(problems).toEqual([
      'version 2 is not supported (expected 1)',
      'extra is not known (version, components)',
      'Button: story is not known (figma, code, stories)',
      'Button: figma.file "x" is not a Figma file key or link',
      'Button: figma needs key (the component or component set key) or node (its node id)',
      'Button: code.import must be { "package", "export" }, as in import { Button } from "@acme/react"',
      'button: listed twice (also as Button)',
      'Tabs: figma.node must be a node id like "12:34"',
      'Tabs: figma.properties "Size": prop is missing: the code prop it sets',
      'Tabs: stories must be a list of story ids',
    ]);
    expect(() => parseComponentMap('{')).toThrow(/bridge.components.json: not valid JSON/);
    expect(readComponentMap(null)).toEqual({ map: null, problems: [] });
    expect(readComponentMap('[]').problems).toEqual(['expected an object with version and components']);
  });

  it('reports linked, unmapped and unknown components; an invalid file is the only failure', () => {
    const text = JSON.stringify({ version: 1, components: { Button: button, Gone: { code: { import: { package: 'p', export: 'Gone' } } } } });
    const r = componentMapReport(text, ['Button', 'Card']);
    expect(r).toEqual({ present: true, problems: [], linked: ['Button'], unmapped: ['Card'], unknown: ['Gone'] });
    expect(componentMapLines(r)).toEqual(['component map: 1 of 2 components linked to Figma', '  not linked yet: Card', `  warn   Gone is in ${COMPONENT_MAP_FILE} but not in the Library (renamed or removed?)`]);
    expect(componentMapLines(componentMapReport(null, ['Card']))[0]).toMatch(/no bridge.components.json yet, 1 components not linked/);
    const bad = componentMapReport('{"version":1}', ['Card']);
    expect(bad.problems.length).toBe(1);
    expect(componentMapLines(bad)[0]).toBe('component map: bridge.components.json is invalid');
  });

  it("this repository's map is valid and names Library components only, each linked to the team's Figma file", () => {
    const text = readFileSync(join(__dirname, '../../..', COMPONENT_MAP_FILE), 'utf8');
    const map = parseComponentMap(text);
    expect(serializeComponentMap(map)).toBe(text);
    for (const [name, e] of Object.entries(map.components)) {
      expect(e.figma?.file, name).toBe('IEhO7sznq4yr6X5iLqZqzz');
      // Toast is called through useToast: nothing named Toast to import.
      if (name !== 'Toast') expect(e.code?.import).toEqual({ package: '@bridge-ds/react', export: name });
    }
  });
});

describe('proposing map entries', () => {
  const library: LibraryComponentInput[] = [
    { name: 'Button', props: [{ name: 'size', type: 'ButtonSize', values: ['sm', 'md'] }, { name: 'loading', type: 'boolean' }], import: { package: '@acme/react', export: 'Button' } },
    { name: 'TextInput', props: [{ name: 'size', values: ['sm', 'md'] }] },
    { name: 'Badge', props: [{ name: 'tone', values: ['info', 'danger'] }] },
    { name: 'Card' },
  ];

  it('matches by name, maps properties and values of the same name, and leaves the rest out', () => {
    const figma: FigmaComponentInput[] = [
      { name: 'Actions/Button', key: 'k1', node: '1-2', type: 'COMPONENT_SET', properties: { Size: { type: 'VARIANT', variantOptions: ['sm', 'md', 'XL'] }, 'Loading#3:0': { type: 'BOOLEAN' }, Icon: { type: 'INSTANCE_SWAP' } } },
      { name: 'Size=sm, State=hover', key: 'variant' },
      { name: '.base', key: 'private' },
      { name: 'Text input', key: 'k2' },
      { name: 'Avatar', key: 'k3' },
    ];
    const p = proposeComponentMap({ library, figma, file: `https://www.figma.com/design/${FILE}/x` });
    expect(p.proposed.map((x) => x.component)).toEqual(['Button', 'TextInput']);
    expect(p.proposed[0]).toEqual({
      component: 'Button',
      entry: {
        figma: { file: FILE, key: 'k1', node: '1:2', properties: { Size: { prop: 'size', values: { sm: 'sm', md: 'md' } }, 'Loading#3:0': { prop: 'loading' } } },
        code: { import: { package: '@acme/react', export: 'Button' } },
      },
      matchedBy: 'name and properties',
      unmappedProperties: ['Size=XL', 'Icon'],
    });
    expect(p.proposed[1]!.entry.figma).toEqual({ file: FILE, key: 'k2', name: 'Text input' });
    expect(p.proposed[1]!.matchedBy).toBe('name');
    expect(p.unmatched).toEqual({ library: ['Badge', 'Card'], figma: ['Avatar'] });
    expect(p.ambiguous).toEqual([]);
  });

  it('picks between same-named components by their properties, and never guesses a tie', () => {
    const p = proposeComponentMap({
      library,
      file: FILE,
      figma: [
        { name: 'Badge', key: 'old' },
        { name: 'badge', key: 'new', properties: { Tone: { type: 'VARIANT', values: ['info'] } } },
        { name: 'Card', key: 'c1' },
        { name: 'Card', key: 'c2' },
      ],
    });
    expect(p.proposed.find((x) => x.component === 'Badge')!.entry.figma!.key).toBe('new');
    expect(p.ambiguous).toEqual([{ component: 'Card', candidates: [{ name: 'Card', key: 'c1' }, { name: 'Card', key: 'c2' }], why: '2 Figma components are named like Card and their properties do not tell them apart' }]);
  });

  it('needs a Figma file and a key or node to propose a link', () => {
    const p = proposeComponentMap({ library, figma: [{ name: 'Card', key: 'c' }, { name: 'Badge' }] });
    expect(p.proposed).toEqual([]);
    expect(p.ambiguous.map((a) => a.why)).toEqual(['the Figma file is not known: pass the file', 'the Figma file is not known: pass the file']);
    expect(proposeComponentMap({ library, file: FILE, figma: [{ name: 'Card' }] }).ambiguous[0]!.why).toBe('the Figma component has no key or node id');
  });

  it('merges into the map without replacing a link a person made, and describes it for reviewers', () => {
    const existing = parseComponentMap({ version: 1, components: { button: button, Card: { code: { import: { package: '@acme/react', export: 'Card' } } } } });
    const p = proposeComponentMap({ library, file: FILE, figma: [{ name: 'Button', key: 'other' }, { name: 'Card', key: 'c1', node: '5:6' }] });
    const m = mergeComponentMap(existing, p.proposed);
    expect(m.added).toEqual(['Card']);
    expect(m.kept).toEqual(['button']);
    expect(m.map.components.button!.figma!.key).toBe('k-button');
    expect(m.map.components.Card).toEqual({ figma: { file: FILE, key: 'c1', node: '5:6' }, code: { import: { package: '@acme/react', export: 'Card' } } });
    expect(existing.components.Card!.figma).toBeUndefined();
    expect(validateComponentMap(m.map)).toEqual([]);
    const body = componentMapProposalBody(p, m, { fileUrl: `https://www.figma.com/design/${FILE}/`, tool: 'Bridge MCP (source: mcp)' });
    expect(body).toContain('| Card | Card | name | nothing |');
    expect(body).toContain('Already linked, kept as they are: button.');
    expect(body).toContain('**No Figma component with the same name:** TextInput, Badge.');
    expect(body).not.toMatch(/—/);
  });

  it('compares names without case, spaces, dashes or the page path', () => {
    expect(matchName('Forms/Text input')).toBe('textinput');
    expect(matchName('❖ Text-Input')).toBe('textinput');
  });
});
