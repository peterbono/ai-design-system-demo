// Sets drawn under a component's folder (Dialog/Popup, the popup drawn open; Pagination/Full, a fixed prop): the measure
// writes them as entries that name their set, so the fix loop finds them by the Figma set's name. The fixture is the
// real measure of Overlays/Dialog (deployed Storybook, 2026-11-04) and what the plugin's Check fidelity saw.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyFixes,
  asFolderSetStory,
  folderSetComponent,
  gapCaseFor,
  measuredSetName,
  parseFidelityRun,
  parseMeasuredSpecsFile,
  specsFromMeasure,
  storiesOfComponent,
  tryFigmaFixes,
  type FolderSetRef,
  type MeasuredSpecsFile,
  type MeasuredSpecsStory,
} from '../src';

const raw = (): MeasuredSpecsFile => parseMeasuredSpecsFile(readFileSync(join(__dirname, 'fixtures/gap/dialog-measured.json'), 'utf8'));
const run = () => parseFidelityRun(readFileSync(join(__dirname, 'fixtures/gap/dialog-popup-fidelity.json'), 'utf8'));

/** Dialog/Popup as component-specs.json draws it: the open popup, a Size axis on DialogContent's size prop. */
const POPUP: FolderSetRef = { name: 'Dialog/Popup', view: 'popup', axes: [{ name: 'Size', prop: 'size', values: ['sm', 'md', 'lg'], default: 'md' }], rootClasses: ['popup'] };

/** What `bridge specs --measure --check` now writes for it: the component's stories that show the popup, as its entries. */
function withPopupSet(file: MeasuredSpecsFile): MeasuredSpecsFile {
  const entries = file.stories.map((s) => asFolderSetStory(s, POPUP)).filter((s): s is MeasuredSpecsStory => !!s);
  const parent = file.components!.find((c) => c.title === 'Overlays/Dialog');
  return { ...file, stories: [...file.stories, ...entries], components: [...file.components!, folderSetComponent(parent, POPUP, 'Overlays/Dialog/Popup')] };
}

describe('measuredSetName', () => {
  it('is the set an entry names, else the last segment of its title', () => {
    expect(measuredSetName({ title: 'Figma variants/Radio' })).toBe('Radio');
    expect(measuredSetName({ title: 'Overlays/Dialog/Popup', set: 'Dialog/Popup' })).toBe('Dialog/Popup');
  });
});

describe('asFolderSetStory', () => {
  it('takes a popup story whose root is the set root, with the axis prop read from its classes', () => {
    const [md, sm] = raw().stories;
    const e = asFolderSetStory(md!, POPUP)!;
    expect(e).toMatchObject({ id: 'overlays-dialog--default', title: 'Overlays/Dialog/Popup', set: 'Dialog/Popup', props: { size: 'md' } });
    expect(e.spec).toBe(md!.spec);
    expect(asFolderSetStory(sm!, POPUP)!.props).toMatchObject({ size: 'sm' });
  });

  it('leaves out a story that is not the set: another root, other fixed props, an error', () => {
    const [md] = raw().stories;
    expect(asFolderSetStory(md!, { ...POPUP, rootClasses: ['tooltip'] })).toBeUndefined();
    // Popover/Popup's static root names .popup and .body (folded in): the element carries the first.
    expect(asFolderSetStory(md!, { ...POPUP, rootClasses: ['popup', 'body'] })).toMatchObject({ set: 'Dialog/Popup' });
    const full: FolderSetRef = { name: 'Pagination/Full', fixed: { variant: 'full' }, axes: [{ name: 'Size', prop: 'size', values: ['sm', 'md'] }], rootClasses: ['pagination'] };
    const story = { ...md!, title: 'Navigation/Pagination', props: { variant: 'full', size: 'sm' } };
    expect(asFolderSetStory(story, full)).toMatchObject({ title: 'Navigation/Pagination/Full', set: 'Pagination/Full', props: { variant: 'full', size: 'sm' } });
    expect(asFolderSetStory({ ...story, overrides: { variant: 'compact' } }, full)).toBeUndefined();
    expect(asFolderSetStory({ ...md!, error: 'did not render' }, POPUP)).toBeUndefined();
  });

  it('gives the set component the axis props its stories do not declare', () => {
    const parent = raw().components![0]!;
    const c = folderSetComponent(parent, POPUP, 'Overlays/Dialog/Popup');
    expect(c).toMatchObject({ title: 'Overlays/Dialog/Popup', set: 'Dialog/Popup', name: 'Dialog/Popup', argTypes: { size: { kind: 'enum', options: ['sm', 'md', 'lg'], default: 'md' } } });
    expect(c.argTypes.disablePointerDismissal).toEqual(parent.argTypes.disablePointerDismissal);
  });
});

describe('the fix loop on a set under a folder', () => {
  it('had no set to rebuild before: the stories are filed under Dialog', () => {
    expect(gapCaseFor({ component: 'Dialog/Popup', measured: raw(), run: run() }).spec).toBeUndefined();
    expect(storiesOfComponent(raw(), 'Dialog/Popup')).toHaveLength(0);
  });

  it('rebuilds Dialog/Popup from its entries, one variant per size, and builds its gap case', () => {
    const measured = withPopupSet(raw());
    expect(storiesOfComponent(measured, 'Dialog/Popup')).toHaveLength(2);
    const { specs } = specsFromMeasure(measured, { only: 'Dialog/Popup' });
    expect(specs.components.map((c) => c.name)).toEqual(['Dialog/Popup']);
    const { gap, spec } = gapCaseFor({ component: 'Dialog/Popup', measured, run: run() });
    expect(spec?.name).toBe('Dialog/Popup');
    expect(spec!.variants.map((v) => v.props.Size ?? v.props.size).sort()).toEqual(['md', 'sm']);
    expect(gap.variants.map((v) => [v.key, v.story?.id])).toEqual([
      ['Size=sm', 'overlays-dialog--controlled'],
      ['Size=md', 'overlays-dialog--default'],
    ]);
  });

  it('applies and tries a fix written for Dialog/Popup', () => {
    const measured = withPopupSet(raw());
    const fix = { id: 'dialog-popup-note', kind: 'status', component: 'Dialog/Popup', reason: 'A note on the open popup.' };
    const fixed = applyFixes(measured, [fix as never]);
    expect(fixed.applied[0]).toMatchObject({ result: 'applied', component: 'Dialog/Popup' });
    const tried = tryFigmaFixes({ component: 'Dialog/Popup', measured, run: run(), proposed: [{ ...fix, id: 'dialog-popup-hide-header', kind: 'part', part: 'root', height: 'hug', reason: 'The popup hugs its content in code.' }] });
    expect(tried.status).toBe('checked');
    expect(tried.variants.map((v) => v.verdict)).not.toContain('gone');
  });
});
