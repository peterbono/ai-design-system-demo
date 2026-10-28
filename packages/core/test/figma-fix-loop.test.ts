// The correction loop's referee, offline, on real Carbon measures: which components differ, one gap case, and the
// values check of proposed fixes (validated, laid on the measure, the set rebuilt as the plugin pulls it, each differing
// variant compared with the code before and after). The pixel check runs later in the plugin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyFixes,
  figmaFixesPrBody,
  figmaGaps,
  fixPrompt,
  gapCaseFor,
  matchVariant,
  mergeFigmaFixes,
  parseFidelityRun,
  parseFixReply,
  parseMeasuredSpecsFile,
  specsFromMeasure,
  statusFixFor,
  tryFigmaFixes,
  validateFigmaFixes,
  type FigmaFidelityRun,
  type FigmaFixesFile,
  type MeasuredSpecsFile,
  type SpecAxis,
} from '../src';

const loadWithBoxes = (): MeasuredSpecsFile => parseMeasuredSpecsFile(readFileSync(join(__dirname, 'fixtures/gap/carbon-measured.json'), 'utf8'));
/**
 * The loop's scenario: a gap the build cannot see. carbon-measured-hidden-boxes.json is the same measure without the
 * boxes of the TextInput's label row and field group: nothing tells their measured height from their content's, so the
 * set hugs (72 for 84) and fixes must close it. With the boxes, the pull keeps those heights by itself.
 */
const load = (): MeasuredSpecsFile => parseMeasuredSpecsFile(readFileSync(join(__dirname, 'fixtures/gap/carbon-measured-hidden-boxes.json'), 'utf8'));

/** What the plugin saw for TextInput: 72 px tall in Figma vs 84 in code, the label wrapper hugging its label. */
const textInputRun = (): FigmaFidelityRun => JSON.parse(readFileSync(join(__dirname, 'fixtures/gap/textinput-fidelity.json'), 'utf8'));

const labelFixed = { id: 'textinput-label-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-label-wrapper', height: 'fixed', reason: 'Carbon keeps 24 px for the label row; Figma hugged the 16 px label.', by: 'claude' };
const outerFixed = { id: 'textinput-field-height', kind: 'part', component: 'TextInput', part: 'cds--text-input-field-outer-wrapper', height: 'fixed', reason: 'The field and its helper keep their measured height with the 4 px gap.', by: 'claude' };


describe('figmaGaps', () => {
  it('lists Differs and Can\'t check from the fidelity run, never a matching component', () => {
    const rows = figmaGaps(loadWithBoxes(), textInputRun());
    expect(rows.map((r) => [r.component, r.status, r.source])).toEqual([
      ['TextInput', 'differs', 'fidelity'],
      ['IconButton', 'cant-check', 'fidelity'],
    ]);
    expect(rows[0]!.summary).toBe('TextInput differs from its story on 1 of 2 variants: 12% of pixels on Invalid=false.');
    expect(rows[1]!.summary).toBe('IconButton was not compared with its story: No render of the story.');
  });

  it('a status fix speaks for the component with its reason', async () => {
    const { applyFixes } = await import('../src');
    const fixes: FigmaFixesFile = { version: 1, fixes: [{ id: 'iconbutton-tooltip', kind: 'status', component: 'IconButton', status: 'cant-check', reason: 'The tooltip opens on hover in code; Figma draws the button alone.' }] };
    const rows = figmaGaps(applyFixes(loadWithBoxes(), fixes).file, textInputRun());
    expect(rows.find((r) => r.component === 'IconButton')).toMatchObject({ status: 'cant-check', source: 'figma-fixes', summary: 'The tooltip opens on hover in code; Figma draws the button alone.', fixes: ['iconbutton-tooltip'] });
  });

  it('reads a bare report and one component result too', () => {
    const run = textInputRun();
    expect(parseFidelityRun(JSON.stringify(run.report)).report.components).toHaveLength(3);
    expect(parseFidelityRun(run.report.components[0]).report.components[0]!.component).toBe('TextInput');
    expect(() => parseFidelityRun({ nope: 1 })).toThrow(/not a fidelity report/);
  });
});

describe('gapCaseFor', () => {
  it('builds the gap the way the plugin pulls: fixes on, set rebuilt, the run\'s verdicts and boxes', () => {
    const { gap, spec } = gapCaseFor({ component: 'TextInput', measured: loadWithBoxes(), run: textInputRun() });
    expect(spec?.name).toBe('TextInput');
    expect(gap.referee).toBe('shots');
    expect(gap.differing).toBe(1);
    expect(gap.variants[0]!.key).toBe('Invalid=false');
    expect(gap.summary).toBe('TextInput differs from the code on 1 of 2 variants. Height 72 in Figma vs 84 in code: 8 px missing below the label, 4 px missing below the text input field wrapper.');
  });
});

describe('tryFigmaFixes (values referee)', () => {
  it('round 1: the label row fixed at 24 moves the height closer (80 vs 84)', () => {
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), run: textInputRun(), proposed: [labelFixed] });
    expect(r.status).toBe('checked');
    expect(r.applied).toEqual([expect.objectContaining({ id: 'textinput-label-height', result: 'applied' })]);
    const d = r.variants[0]!.differences.find((x) => x.property === 'height')!;
    expect(d).toMatchObject({ before: 72, after: 80, deltaBefore: -12, deltaAfter: -4, result: 'closer', estimated: true });
    expect(r.verdict).toBe('closer');
    expect(r.summary).toMatch(/^Closer to the code on the measured values: 0 of 1 difference resolved, 1 closer\. The pixel check runs in the plugin after the next pull\.$/);
  });

  it('round 2: with the field group fixed too, the height is resolved', () => {
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), run: textInputRun(), proposed: [labelFixed, outerFixed] });
    const d = r.variants[0]!.differences.find((x) => x.property === 'height')!;
    expect(d).toMatchObject({ after: 84, deltaAfter: 0, result: 'resolved' });
    expect(r.verdict).toBe('closer');
    expect(r.file!.fixes.map((f) => f.id)).toEqual(['textinput-label-height', 'textinput-field-height']);
  });

  it('a padding that pushes the wrong way is worse', () => {
    const shrink = { id: 'textinput-shrink', kind: 'part', component: 'TextInput', part: 'root', set: { paddingTop: -6 }, reason: 'A wrong guess that makes the field shorter.' };
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), run: textInputRun(), proposed: [shrink] });
    expect(r.variants[0]!.differences[0]).toMatchObject({ after: 66, result: 'worse' });
    expect(r.verdict).toBe('worse');
  });

  it('a value that disagrees with the code where it agreed is a regression', () => {
    const red = { id: 'textinput-red', kind: 'part', component: 'TextInput', part: 'cds--text-input', set: { fill: 'cds.support.error' }, reason: 'A wrong guess on the field fill.' };
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), run: textInputRun(), proposed: [red] });
    expect(r.variants[0]!.regressions.map((x) => x.property)).toContain('fill');
    expect(r.verdict).toBe('worse');
  });

  it('refuses invalid fixes and fixes for another component, with every problem', () => {
    const bad = tryFigmaFixes({ component: 'TextInput', measured: load(), run: textInputRun(), proposed: [{ ...labelFixed, height: 'tall' }] });
    expect(bad.status).toBe('invalid');
    expect(bad.problems).toEqual(['fix textinput-label-height: height is hug, fill, fixed or a size in px']);
    const other = tryFigmaFixes({ component: 'TextInput', measured: load(), run: textInputRun(), proposed: [{ ...labelFixed, component: 'Toggle' }] });
    expect(other.problems[0]).toMatch(/this loop fixes TextInput only/);
    expect(tryFigmaFixes({ component: 'TextInput', measured: load(), proposed: [] }).problems).toEqual(['fixes must be a non-empty list of fix objects']);
  });

  it('a status fix moves nothing and says so', () => {
    const st = { id: 'textinput-differs', kind: 'status', component: 'TextInput', status: 'differs', reason: 'The label row height comes from a line-height Figma does not have.' };
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), run: textInputRun(), proposed: [st] });
    expect(r.verdict).toBe('same');
    expect(r.summary).toMatch(/change how the set is named or labelled, not what it draws/);
  });

  it('an axis map renames the variant: it is still compared, not gone', () => {
    const map = { id: 'textinput-invalid-error', kind: 'axis', action: 'map', component: 'TextInput', arg: 'invalid', property: 'Error', values: { false: 'Off', true: 'On' }, reason: 'Designers call the invalid look Error, on or off.' };
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), run: textInputRun(), proposed: [map, labelFixed] });
    expect(r.variants[0]).toMatchObject({ key: 'Invalid=false', verdict: 'closer' });
    expect(r.variants[0]!.differences[0]).toMatchObject({ after: 80, result: 'closer' });
    const after = specsFromMeasure(applyFixes(load(), r.file!).file).specs.components.find((c) => c.name === 'TextInput')!;
    expect(after.variants.map((v) => v.props)).toContainEqual({ Error: 'Off' });
  });

  it('a variant the rebuilt set does not have says the referee compared nothing, not 0 of 0', () => {
    // What a reviewer met on #598: every differing variant came back gone, and the summary read as a measurement.
    const run = textInputRun();
    const c = run.report.components.find((x) => x.component === 'TextInput')!;
    c.variants = c.variants.map((v) => (v.key === 'Invalid=false' ? { ...v, key: 'Invalid=false, Size=sm' } : v));
    c.worst = { ...c.worst!, key: 'Invalid=false, Size=sm' };
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), run, proposed: [labelFixed] });
    expect(r.variants).toEqual([expect.objectContaining({ key: 'Invalid=false, Size=sm', verdict: 'gone', differences: [] })]);
    expect(r.summary).toBe('The values referee compared nothing: the differing variant is not in the rebuilt set. Pull this branch in the DS Bridge Figma plugin and run Check fidelity to see what the fixes do.');
    expect(r.summary).not.toMatch(/0 of 0/);
  });

  it('a run key with fewer axes than the rebuilt set still finds its variant, not gone (#605)', () => {
    // The run's key carries only the axes that vary between its shots. Here none vary for the differing shot, so its
    // key is "Default" while the set has an Invalid axis: the variant at the axis default is the one the shot drew.
    const run = textInputRun();
    const c = run.report.components.find((x) => x.component === 'TextInput')!;
    c.variants = c.variants.filter((v) => v.key === 'Invalid=false').map((v) => ({ ...v, key: 'Default' }));
    c.worst = { ...c.worst!, key: 'Default' };
    // What the plugin read back from the layers is keyed the same way as the run.
    run.built = { TextInput: { Default: run.built!.TextInput!['Invalid=false']! } };
    const { gap } = gapCaseFor({ component: 'TextInput', measured: load(), run });
    expect(gap.variants[0]).toMatchObject({ key: 'Default', props: { Invalid: 'false' } });
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), run, proposed: [labelFixed] });
    expect(r.variants[0]).toMatchObject({ key: 'Default', verdict: 'closer' });
    expect(r.variants[0]!.differences.find((x) => x.property === 'height')).toMatchObject({ before: 72, after: 80, result: 'closer' });
    // The regressions check runs too: it needs the variant before the fixes.
    const red = { id: 'textinput-red', kind: 'part', component: 'TextInput', part: 'cds--text-input', set: { fill: 'cds.support.error' }, reason: 'A wrong guess on the field fill.' };
    const worse = tryFigmaFixes({ component: 'TextInput', measured: load(), run, proposed: [red] });
    expect(worse.variants[0]!.regressions.map((x) => x.property)).toContain('fill');
  });

  it('a proposed fix with the id of one in the repo replaces it', () => {
    const existing: FigmaFixesFile = { version: 1, fixes: [{ ...labelFixed, height: 20 } as never] };
    const merged = mergeFigmaFixes(existing, [labelFixed as never]);
    expect(merged.fixes).toHaveLength(1);
    expect((merged.fixes[0] as { height?: unknown }).height).toBe('fixed');
    const r = tryFigmaFixes({ component: 'TextInput', measured: load(), fixes: existing, run: textInputRun(), proposed: [labelFixed] });
    expect(r.status).toBe('checked');
    expect(r.file!.fixes).toHaveLength(1);
  });
});

describe('matchVariant (a report key against the set)', () => {
  // The rebuilt Button set of #605: five axes, while the run's keys carry the three that vary between the shots.
  const axes: SpecAxis[] = [
    { name: 'Variant', prop: 'variant', values: ['primary', 'secondary'], default: 'primary' },
    { name: 'Size', prop: 'size', values: ['sm', 'md'], default: 'md' },
    { name: 'State', values: ['Default', 'Hover'], default: 'Default' },
    { name: 'Loading', prop: 'loading', values: ['false', 'true'], default: 'false' },
    { name: 'Full width', prop: 'fullWidth', values: ['false', 'true'], default: 'false' },
  ];
  const variants = ['false', 'true'].flatMap((Loading) => ['false', 'true'].map((fw) => ({ props: { Loading, 'Full width': fw, Variant: 'primary', Size: 'sm', State: 'Default' } })));
  const set = { axes, variants };
  const wanted = { Size: 'sm', State: 'Default', Variant: 'primary' };

  it('a three-axis key finds the five-axis variant whose other axes sit at their default', () => {
    expect(matchVariant(set, wanted)?.props).toEqual({ Loading: 'false', 'Full width': 'false', Variant: 'primary', Size: 'sm', State: 'Default' });
  });

  it('the exact key wins, and a key with an axis the set lacks finds nothing', () => {
    const full = { Loading: 'true', 'Full width': 'false', Variant: 'primary', Size: 'sm', State: 'Default' };
    expect(matchVariant(set, full)).toBe(variants.find((v) => v.props.Loading === 'true' && v.props['Full width'] === 'false'));
    expect(matchVariant(set, { ...wanted, Tone: 'loud' })).toBeUndefined();
    expect(matchVariant(set, { ...wanted, Size: 'lg' })).toBeUndefined();
  });

  it('keeps nothing when the defaults do not settle it: no guess', () => {
    // No variant has both extra axes at their default: three candidates, none preferred.
    const noDefault = { axes, variants: variants.filter((v) => !(v.props.Loading === 'false' && v.props['Full width'] === 'false')) };
    expect(matchVariant(noDefault, wanted)).toBeUndefined();
    // Without axes, "false" counts as the default.
    expect(matchVariant({ variants }, wanted)?.props).toMatchObject({ Loading: 'false', 'Full width': 'false' });
  });
});

describe('prompt, reply and pull request body', () => {
  it('the prompt carries the schema, the gap and the earlier rounds; the reply parser takes fenced or bare JSON', () => {
    const { gap } = gapCaseFor({ component: 'TextInput', measured: loadWithBoxes(), run: textInputRun() });
    const p = fixPrompt(gap, [{ fixes: [labelFixed], feedback: 'height: closer (-12 px -> -4 px)', verdict: 'closer' }]);
    expect(p).toContain('kind "part"');
    expect(p).toContain('8 px missing below the label');
    expect(p).toContain('Round 1: you proposed');
    expect(p).not.toMatch(/\u2014/);
    expect(parseFixReply('Here:\n```json\n[{"id":"a","kind":"status"}]\n```')).toEqual([{ id: 'a', kind: 'status' }]);
    expect(parseFixReply('{"fixes":[{"id":"b"}]}')).toEqual([{ id: 'b' }]);
    expect(() => parseFixReply('no idea')).toThrow(/no JSON/);
  });

  it('the status fix after the last round is valid', () => {
    const { gap } = gapCaseFor({ component: 'TextInput', measured: loadWithBoxes(), run: textInputRun() });
    const f = statusFixFor(gap, ['textinput-differs']);
    expect(f.id).toBe('textinput-differs-2');
    expect(validateFigmaFixes({ version: 1, fixes: [f] })).toEqual([]);
  });

  it('the body has the gap, each fix with its reason, and before and after', () => {
    const measured = load();
    const run = textInputRun();
    const { gap } = gapCaseFor({ component: 'TextInput', measured, run });
    const tried = tryFigmaFixes({ component: 'TextInput', measured, run, proposed: [labelFixed, outerFixed] });
    const body = figmaFixesPrBody({ component: 'TextInput', summary: 'TextInput keeps its label row and field heights.', gap, tried, fixes: tried.file!.fixes, tool: 'Bridge MCP' });
    expect(body).toContain('- `textinput-label-height` (part): cds--text-input-label-wrapper: height fixed. Carbon keeps 24 px');
    expect(body).toContain('Height 72 in Figma vs 84 in code');
    expect(body).toContain('resolved (-12 px, now 0 px, estimated)');
    expect(body).toContain('run Check fidelity before approving');
    expect(body).not.toMatch(/\u2014/);
  });

  it('a long before and after leads with the values, explains itself first, and folds the variants away', () => {
    const measured = load();
    const run = textInputRun();
    const { gap } = gapCaseFor({ component: 'TextInput', measured, run });
    const tried = tryFigmaFixes({ component: 'TextInput', measured, run, proposed: [labelFixed] });
    const many = { ...tried, variants: Array.from({ length: 9 }, (_, i) => ({ ...tried.variants[0]!, key: `Invalid=false, N=${i}` })) };
    const body = figmaFixesPrBody({ component: 'TextInput', summary: 'TextInput keeps its label row height.', gap, tried: many, fixes: tried.file!.fixes, tool: 'Bridge MCP' });
    expect(body).toContain('- root height, 9 variants: 72 in Figma against 84 in code, now 80: closer');
    expect(body).toContain('<summary>Variant by variant (9)</summary>');
    expect(body.indexOf('9 variants: 72 in Figma')).toBeLessThan(body.indexOf('<details>'));
  });

  it('variants the rebuilt set does not have say so, with the caveat before the evidence', () => {
    // #598: 32 variants read "gone" under a "0 of 0 differences resolved" summary, and the sentence that explained
    // the section came after all 32 lines.
    const measured = load();
    const run = textInputRun();
    const { gap } = gapCaseFor({ component: 'TextInput', measured, run });
    const tried = tryFigmaFixes({ component: 'TextInput', measured, run, proposed: [labelFixed] });
    const gone = {
      ...tried,
      verdict: 'same' as const,
      summary: 'The values referee compared nothing: none of the 32 differing variants is in the rebuilt set.',
      variants: Array.from({ length: 32 }, (_, i) => ({ key: `Size=sm, State=Default, Variant=v${i}`, verdict: 'gone' as const, differences: [], regressions: [] })),
    };
    const body = figmaFixesPrBody({ component: 'TextInput', summary: 'TextInput keeps its label row height.', gap, tried: gone, fixes: tried.file!.fixes, tool: 'Bridge MCP' });
    expect(body).toContain('- Size=sm, State=Default, Variant=v0: not in the rebuilt set');
    expect(body).not.toContain(': gone');
    const caveat = body.indexOf("The values referee can't judge layout");
    expect(caveat).toBeGreaterThan(-1);
    expect(caveat).toBeLessThan(body.indexOf('<details>'));
    expect(caveat).toBeLessThan(body.indexOf('Variant=v0'));
  });
});

describe('sizes of their own, from the boxes', () => {
  it('with the boxes, the label row keeps its measured height around its label: no fix needed', () => {
    const spec = specsFromMeasure(loadWithBoxes()).specs.components.find((c) => c.name === 'TextInput')!;
    const label = spec.variants.find((v) => v.props.Invalid === 'false') ?? spec.variants[0]!;
    expect(label.values['cds--text-input-label-wrapper']?.height).toBe(24);
    // Without them, it hugs its label: the gap the loop closes above.
    const hidden = specsFromMeasure(load()).specs.components.find((c) => c.name === 'TextInput')!;
    expect((hidden.variants.find((v) => v.props.Invalid === 'false') ?? hidden.variants[0]!).values['cds--text-input-label-wrapper']?.height).toBeUndefined();
  });
});

describe('a measure with a looping part tree (two parts named root, measured before root ids were reserved)', () => {
  /** The measure plus a story whose inner `.root` element took the root's id: root -> text -> description -> root. */
  const withLoop = (): MeasuredSpecsFile => {
    const file = loadWithBoxes();
    const base = file.stories.find((s) => s.spec && !s.error && s.title.split('/').at(-1) !== 'TextInput')!;
    const spec = structuredClone(base.spec!);
    spec.parts = [
      { id: 'root', name: 'Root', kind: 'frame' },
      { id: 'text', name: 'Text', kind: 'frame', parent: 'root' },
      { id: 'description', name: 'Description', kind: 'frame', parent: 'text' },
      { id: 'root', name: 'Root', kind: 'frame', parent: 'description' },
      { id: 'title', name: 'Title', kind: 'text', parent: 'text' },
    ] as typeof spec.parts;
    return { ...file, stories: [...file.stories, { ...base, id: 'forms-loopcard--conflict', title: 'Forms/LoopCard', name: 'Conflict', spec }] };
  };

  it('builds every set without looping', () => {
    const { specs } = specsFromMeasure(withLoop());
    expect(specs.components.some((c) => c.name === 'TextInput')).toBe(true);
  });

  it("a gap case builds only its own component's set", () => {
    const only = specsFromMeasure(withLoop(), { only: 'TextInput' }).specs.components;
    expect(only.map((c) => c.name)).toEqual(['TextInput']);
    const all = specsFromMeasure(loadWithBoxes()).specs.components.find((c) => c.name === 'TextInput');
    expect(only[0]).toEqual(all);
    const { gap, spec } = gapCaseFor({ component: 'TextInput', measured: withLoop(), run: textInputRun() });
    expect(spec?.name).toBe('TextInput');
    expect(gap.variants.length).toBeGreaterThan(0);
  });
});

describe('pairParts on a looping measured tree', () => {
  it('pairs a text whose measured ancestors loop, without looping itself', async () => {
    const { pairParts } = await import('../src/measured-spec');
    const staticParts = [
      { id: 'root', name: 'Root', kind: 'frame' as const },
      { id: 'body', name: 'Body', kind: 'frame' as const, parent: 'root' },
      { id: 'label', name: 'Label', kind: 'text' as const, parent: 'body', characters: 'Hi' },
    ];
    const measured = {
      parts: [
        { id: 'root', name: 'Root', kind: 'frame' as const },
        { id: 'text', name: 'Text', kind: 'frame' as const, parent: 'root' },
        { id: 'description', name: 'Description', kind: 'frame' as const, parent: 'text' },
        { id: 'root', name: 'Root', kind: 'frame' as const, parent: 'description' },
        { id: 't', name: 'T', kind: 'text' as const, parent: 'description', characters: 'Hi' },
      ],
    };
    expect(pairParts(staticParts, measured).get('label')).toBe('t');
  });
});
