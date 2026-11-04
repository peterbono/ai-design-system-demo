// One colour per stage on every page: the Being built tags, the Changes rows and the exploration tag (Home cards, the
// exploration and product pages) all read LIFECYCLE_TONE, so the same words never wear two colours.
import { describe, expect, it } from 'vitest';
import type { BuildRequestView } from '@bridge-ds/core';
import { LIFECYCLE_LABEL, LIFECYCLE_TONE } from './review-state';
import { statusTag } from './building-view';
import { explorationTag } from './exploration-page';

type Tagged = Pick<BuildRequestView, 'status' | 'label' | 'stale'>;
const build = (status: Tagged['status'], label: string, stale = false): Tagged => ({ status, label, stale });

describe('LIFECYCLE_TONE', () => {
  it('waiting is amber, moving is Harbor, shipped is green, over is grey', () => {
    expect(LIFECYCLE_TONE['waiting-for-code']).toBe('warning');
    expect(LIFECYCLE_TONE['in-review']).toBe('warning');
    expect(LIFECYCLE_TONE['being-built']).toBe('info');
    expect(LIFECYCLE_TONE.shipped).toBe('success');
    expect(LIFECYCLE_TONE['not-planned']).toBe('neutral');
  });

  it('gives Being built and the exploration tag the same colour for the same words', () => {
    const pairs: [Tagged['status'], string][] = [
      ['requested', 'ready'],
      ['in-progress', 'building'],
      ['shipped', 'shipped'],
    ];
    for (const [buildStatus, explorationStatus] of pairs) {
      const a = statusTag(build(buildStatus, ''));
      const b = explorationTag(explorationStatus);
      expect(a.tone, `${buildStatus} / ${explorationStatus}`).toBe(b.tone);
    }
    expect(explorationTag('ready').label).toBe(LIFECYCLE_LABEL['waiting-for-code']);
    expect(explorationTag('building').label).toBe(LIFECYCLE_LABEL['being-built']);
    // In review is amber wherever it shows, a promoted exploration included.
    expect(explorationTag('promoted').tone).toBe(LIFECYCLE_TONE['in-review']);
    expect(statusTag(build('in-review', '')).tone).toBe(LIFECYCLE_TONE['in-review']);
  });

  it('a request waiting for more than a week keeps its stage colour and says how long in the tag', () => {
    expect(statusTag(build('requested', 'Requested 10 days ago', true))).toEqual({ label: 'Requested 10 days ago', tone: 'warning' });
  });
});
