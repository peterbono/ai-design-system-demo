// The product manager of a product (api/_lib/product-pm.ts, lib/pm-view.ts, core pmOpinionOf): who they are, what
// they said, and that their words never take a turn in the talk with the lead.
import { describe, expect, it } from 'vitest';
import { openDecisionOf, pmOpinionOf, withDecision, withLeadAsked, withoutLeadAsked } from '@bridge-ds/core';
import { addsPmWords, isPm, pmsOf, publicPm, setPm, withPmWord } from '../../api/_lib/product-pm';
import { memberRef } from '../../api/_lib/exploration-member';
import { isViewerPm, newerPmSaid, pmRequired, pmStatusLine } from './pm-view';
import { decisionRows, leadHomeRow } from './lead-decisions';
import { memoryRedis } from '../../api/_lib/redis';

const body = (e: Record<string, unknown> = {}) => `Text\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Late tag', startedAt: '2026-11-01T00:00:00Z', ...e })} -->`;

describe('who the PM is', () => {
  it('is kept per product, never sent with an email', async () => {
    const redis = memoryRedis();
    await setPm(redis, 'Acme/DS', 'admin-app', { email: 'Dino@Acme.com', name: 'Dino' });
    await setPm(redis, 'acme/ds', 'shop', { login: 'lee', name: 'Lee' });
    const all = await pmsOf(redis, 'acme/ds');
    expect(Object.keys(all).sort()).toEqual(['admin-app', 'shop']);
    expect(publicPm(all['admin-app']!)).toEqual({ name: 'Dino', ref: memberRef('dino@acme.com') });
    expect(JSON.stringify(publicPm(all['admin-app']!))).not.toContain('@');
    expect(isPm(all['admin-app']!, { email: 'dino@acme.com' })).toBe(true);
    expect(isPm(all.shop!, { login: 'LEE' })).toBe(true);
    expect(isPm(all.shop!, { email: 'lee@acme.com' })).toBe(false);
    await setPm(redis, 'acme/ds', 'shop', null);
    expect(Object.keys(await pmsOf(redis, 'acme/ds'))).toEqual(['admin-app']);
  });

  it('the page knows its own PM by reference or login', () => {
    expect(isViewerPm({ name: 'Dino', ref: 'abc' }, { ref: 'abc' })).toBe(true);
    expect(isViewerPm({ name: 'Dino', ref: 'abc' }, { login: 'abc' })).toBe(false);
    expect(isViewerPm({ name: 'Lee', login: 'lee' }, { login: 'Lee' })).toBe(true);
    expect(isViewerPm(null, { login: 'lee' })).toBe(false);
  });
});

describe('what the PM says', () => {
  it('goes in the block, in its round, and never takes the lead\'s turn', () => {
    const asked = withLeadAsked(body(), { at: '2026-11-02T00:00:00Z', by: 'goulou' });
    const said = withPmWord(asked, { kind: 'pm-changes', at: '2026-11-03T00:00:00Z', byName: 'Dino', text: 'Show the days late' })!;
    expect(pmOpinionOf(said)).toMatchObject({ kind: 'pm-changes', round: 1, text: 'Show the days late' });
    // Still the lead's turn: the PM's note waits on nobody.
    expect(openDecisionOf(said)).toBeNull();
    expect(leadHomeRow(said, { viewer: 'florian', lead: true, own: false })?.where).toBe('needs');
    // After a lead's Needs changes, the PM's next word is in round 2 and the designer still has the lead's words to answer.
    const changed = withDecision(withoutLeadAsked(said), { kind: 'changes', at: '2026-11-04T00:00:00Z', by: 'florian', text: 'Keep the date' });
    const again = withPmWord(changed, { kind: 'pm-ok', at: '2026-11-05T00:00:00Z', byName: 'Dino' })!;
    expect(pmOpinionOf(again)).toMatchObject({ kind: 'pm-ok', round: 2 });
    expect(openDecisionOf(again)?.kind).toBe('changes');
  });

  it('cannot be written through the proxy', () => {
    const before = body();
    const after = withPmWord(before, { kind: 'pm-ok', at: '2026-11-03T00:00:00Z', byName: 'Dino' })!;
    expect(addsPmWords(before, after)).toBe(true);
    expect(addsPmWords(after, after)).toBe(false);
    expect(addsPmWords(after, before)).toBe(false);
    expect(withPmWord('no block', { kind: 'pm-ok', at: 'x' })).toBeNull();
  });

  it('reads in words', () => {
    expect(pmStatusLine(null, { pm: 'Dino', when: '' })).toBe('Dino has not seen it yet.');
    expect(pmStatusLine({ kind: 'pm-ok' }, { pm: 'Dino', when: 'yesterday' })).toBe('Dino said it looks good, yesterday.');
    expect(pmStatusLine({ kind: 'pm-changes' }, { pm: 'Dino', when: 'today', mine: true })).toBe('You asked for changes, today.');
    expect(pmStatusLine({ kind: 'pm-call', byName: 'Goulou' }, { pm: 'Dino', when: 'today' })).toBe('Goulou said Dino agreed in a call, today.');
    const call = withPmWord(body(), { kind: 'pm-call', at: '2026-11-03T00:00:00Z', byName: 'Goulou', to: ['Dino'] })!;
    const rows = decisionRows(pmOpinionOf(call) ? [pmOpinionOf(call)!] : []);
    expect(rows[0]).toMatchObject({ name: 'Goulou', verb: 'said Dino agreed in a call' });
  });

  it('is required only when no other designer reviews the work', () => {
    expect(pmRequired({ review: 'shared-none' })).toBe(true);
    expect(pmRequired({ designers: 1 })).toBe(true);
    expect(pmRequired({ review: 'one', designers: 4 })).toBe(false);
    expect(pmRequired({})).toBe(false);
  });
});

describe('newerPmSaid', () => {
  const now = Date.parse('2026-11-07T18:30:00Z');
  type Said = { kind: 'pm-ok' | 'pm-changes'; at: string; text?: string };
  const body: Said = { kind: 'pm-changes', at: '2026-11-07T18:20:00Z', text: 'Days first' };
  const here: Said = { kind: 'pm-ok', at: '2026-11-07T18:29:00Z' };
  it('keeps the word just said when the read is older', () => {
    expect(newerPmSaid(body, here, now)).toBe(here);
  });
  it('takes the read once it has caught up', () => {
    const read: Said = { kind: 'pm-ok', at: '2026-11-07T18:29:30Z' };
    expect(newerPmSaid(read, here, now)).toBe(read);
  });
  it('shows the word just said when the read has none', () => {
    expect(newerPmSaid(null, here, now)).toBe(here);
  });
  it('forgets a word said here more than five minutes ago', () => {
    expect(newerPmSaid<Said>(body, { kind: 'pm-ok', at: '2026-11-07T18:20:30Z' }, now + 10 * 60_000)).toBe(body);
  });
});
