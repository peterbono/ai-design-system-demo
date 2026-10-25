// The review block renders from data alone: nothing without motion changes; the sentence, both previews with their
// durations and the other components otherwise. Replay appears once the previews play (in a browser), not here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseComponentSpecs } from '@bridge-ds/core';
import type { MotionChange } from '../../../lib/motion-changes';
import MotionChanges from './MotionChanges';

const specs = parseComponentSpecs(readFileSync(join(__dirname, '../../../../../../packages/react/component-specs.json'), 'utf8'));
const change: MotionChange = {
  source: 'token',
  kind: 'duration',
  token: 'motion.duration.moderate',
  before: { token: 'motion.duration.moderate', ms: 200, label: '200 ms' },
  after: { token: 'motion.duration.moderate', ms: 150, label: '150 ms' },
  components: ['Dialog/Popup', 'AlertDialog/Popup', 'Accordion', 'AccordionItem', 'Tabs', 'Drawer/Popup'],
};
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");

describe('MotionChanges', () => {
  it('renders nothing when the branch changes no motion', () => {
    expect(renderToStaticMarkup(createElement(MotionChanges, { changes: [], specs }))).toBe('');
  });

  it('the sentence, the two previews with their durations, and the other components', () => {
    const html = renderToStaticMarkup(createElement(MotionChanges, { changes: [change], specs }));
    const t = text(html);
    expect(t).toContain('Motion changes');
    expect(t).toContain('Popups open faster: motion.duration.moderate goes from 200 ms to 150 ms.');
    expect(t).toContain('BeforeDialog opens in 200 ms');
    expect(t).toContain('AfterDialog opens in 150 ms');
    expect(t).toContain('Also changes: AlertDialog, Accordion, Tabs · See all 5');
    expect(html).toContain('href="/components/alert-dialog/#motion"');
    expect(html).not.toContain('Replay');
  });
});
