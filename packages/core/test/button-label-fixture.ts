// The Button of #607, small enough to read: a measure whose stories render their own label ("Publish tokens"), and a
// Check fidelity run on a Figma set that draws a shorter label in every variant. The code renders that small button at
// 72 px, Figma at 75; the story's small button is 120.84 px because of its words, not because the code fixes a width.
import type { FigmaFidelityRun, MeasuredSpec, MeasuredSpecsFile, MeasuredSpecsStory } from '../src';

const PAD = 12;
const BORDER = 1;

/**
 * One Button story: a root around a label. `own`: the root is wider than its label plus padding (a min-width the
 * CSS gives it), so its measured width is a size of its own.
 */
function story(size: 'sm' | 'md', labelWidth: number, height: number, own?: number): MeasuredSpecsStory {
  const width = own ?? labelWidth + 2 * PAD + 2 * BORDER;
  const x = (width - labelWidth) / 2;
  const spec: MeasuredSpec = {
    story: 'actions-button--primary',
    parts: [
      { id: 'root', name: 'Root', kind: 'frame', source: `button primary ${size}`, layout: { direction: 'HORIZONTAL', primary: 'CENTER', counter: 'CENTER' } },
      { id: 'label', name: 'Label', kind: 'text', parent: 'root', source: 'label', characters: 'Publish tokens' },
    ],
    values: {
      root: { fill: 'rgb(11, 74, 139)', paddingLeft: PAD, paddingRight: PAD, strokeWeight: BORDER, width, height },
      label: { textFill: 'rgb(255, 255, 255)', fontSize: 14 },
    },
    raw: {
      root: { fill: 'rgb(11, 74, 139)', paddingLeft: PAD, paddingRight: PAD, strokeWeight: BORDER, width, height },
      label: { textFill: 'rgb(255, 255, 255)', fontSize: 14 },
    },
    tokens: {},
    boxes: {
      root: { x: 0, y: 0, width, height },
      label: { x, y: (height - 17) / 2, width: labelWidth, height: 17 },
    },
    coverage: { fields: 0, declared: 0, matched: 0, literal: 0 },
  };
  const props = { variant: 'primary', size, children: 'Publish tokens', disabled: false };
  return {
    id: 'actions-button--primary',
    title: 'Actions/Button',
    name: 'Primary',
    props,
    ...(size === 'md' ? {} : { overrides: { variant: 'primary', size } }),
    spec,
  } as unknown as MeasuredSpecsStory;
}

/** The measure: md (the default) and sm. `own`: the roots have a width of their own (150 sm, 160 md). */
export function buttonMeasure(opts: { own?: boolean } = {}): MeasuredSpecsFile {
  return {
    version: 1,
    storybook: 'https://storybook.example',
    measuredAt: '2026-10-28T00:00:00.000Z',
    stories: [story('md', 102.84, 44, opts.own ? 160 : undefined), story('sm', 94.84, 32, opts.own ? 150 : undefined)],
    components: [
      {
        title: 'Actions/Button',
        name: 'Button',
        argTypes: {
          children: { kind: 'text', control: 'text' },
          variant: { kind: 'enum', options: ['primary', 'secondary'], default: 'primary', control: 'inline-radio' },
          size: { kind: 'enum', options: ['sm', 'md'], default: 'md', control: 'inline-radio' },
          disabled: { kind: 'boolean', control: 'boolean' },
        },
      },
    ],
  } as unknown as MeasuredSpecsFile;
}

/** Check fidelity on a set drawing a 45 px label: the small button 75 px in Figma, 72 in code. */
export function buttonRun(): FigmaFidelityRun {
  return {
    version: 1,
    report: {
      version: 1,
      checkedAt: '2026-10-28T00:00:00.000Z',
      file: 'Bridge',
      reference: { sha: 'abc', createdAt: '2026-10-28T00:00:00.000Z' },
      options: { scale: 2, threshold: 0.1, radius: 2, maxPercent: 3, sizeTolerance: 1 },
      components: [
        {
          component: 'Button',
          status: 'differs',
          checked: 2,
          differing: 1,
          skipped: 0,
          worst: { key: 'Size=sm', percent: 9.23, size: { figma: { width: 75, height: 32 }, code: { width: 72, height: 32 } } },
          variants: [
            { key: 'Size=sm', status: 'differs', percent: 9.23, size: { figma: { width: 75, height: 32 }, code: { width: 72, height: 32 } } },
            { key: 'Size=md', status: 'matches', percent: 0.6, size: { figma: { width: 79, height: 44 }, code: { width: 80, height: 44 } } },
          ],
        },
      ],
      summary: { components: 1, matches: 0, differs: 1, notChecked: 0, variantsChecked: 2, variantsSkipped: 0 },
    },
    built: {
      Button: {
        'Size=sm': { boxes: { root: { x: 0, y: 0, width: 75, height: 32 }, label: { x: 15, y: 7.5, width: 45, height: 17 } }, hidden: [] },
        'Size=md': { boxes: { root: { x: 0, y: 0, width: 79, height: 44 }, label: { x: 17, y: 13.5, width: 45, height: 17 } }, hidden: [] },
      },
    },
  } as unknown as FigmaFidelityRun;
}
