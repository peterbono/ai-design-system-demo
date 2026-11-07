// Every change says where it comes from, when Bridge knows it: the "Needed by" block of a real change or of the request
// it closes, the seeded sample data on the sample team, and nothing at all otherwise.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withNeededBy, type NeededBy } from '@bridge-ds/core';
import { changeOrigin, neededByOfChange } from './product-branch';
import { changeNeed, person } from './home-model';
import { leadQueue, type DemoPull } from './demo-home';
import { suggestionNeed } from './suggestions-view';
import { SAMPLE_CHANGE_EFFECTS, SAMPLE_CHANGE_ORIGINS, SAMPLE_EFFECTS_BASE, isSampleExploration, sampleChangeOrigin } from './demo';

const needed: NeededBy = { pr: 12, title: 'Billing screen', branch: 'explore/billing', url: 'u', product: 'admin', productName: 'Admin demo', piece: 'p', pieceTitle: 'P' };
const NOW = Date.parse('2026-11-06T12:00:00Z');
const ann = person('ann', 'Ann Leroy', null);
const facts = { number: 3, title: 'Deepen the blue', author: ann, asker: ann, since: null, thumb: { kind: 'icon', icon: 'branch' } as const };

describe('changeOrigin', () => {
  it('names the exploration, its product and its page', () => {
    expect(changeOrigin(needed)).toMatchObject({ name: 'Billing screen', product: 'Admin demo', exploration: true, number: 12, productKey: null });
    expect(changeOrigin(needed)?.href).toContain('changes/?exploration=12');
  });

  it('a product branch is not called an exploration', () => {
    expect(changeOrigin({ ...needed, branch: 'agent/billing' })?.exploration).toBe(false);
  });

  it('carries the product of a branch in the product own repository', () => {
    const o = changeOrigin({ ...needed, repo: 'acme/shop', product: 'shop' });
    expect(o?.productKey).toBe('shop');
    expect(o?.href).toContain('changes/?exploration=12&product=shop');
  });

  it('no block, no origin', () => {
    expect(changeOrigin(null)).toBeNull();
    expect(changeOrigin(undefined)).toBeNull();
  });
});

describe('neededByOfChange', () => {
  const never = () => Promise.reject(new Error('no read expected'));

  it('reads the change itself first, without a read', async () => {
    expect(await neededByOfChange(withNeededBy('Closes #4', needed), never)).toMatchObject({ pr: 12 });
  });

  it('follows "Closes #n" to the request Done exploring filed', async () => {
    const issues: Record<number, string> = { 4: 'A plain issue', 5: withNeededBy('The request', needed) };
    const found = await neededByOfChange('Closes #4\n\nCloses #5', async (n) => issues[n]);
    expect(found).toMatchObject({ title: 'Billing screen' });
  });

  it('a change that closes nothing, or an issue nobody needed, has no origin', async () => {
    expect(await neededByOfChange('## What changed', never)).toBeNull();
    expect(await neededByOfChange(null, never)).toBeNull();
    expect(await neededByOfChange('Closes #4', async () => 'A plain issue')).toBeNull();
  });

  it('a read that fails counts as nothing known', async () => {
    expect(await neededByOfChange('Closes #4', never)).toBeNull();
  });
});

describe('the rows read the link', () => {
  it('a review row says where it comes from, before who asks', () => {
    expect(changeNeed({ ...facts, task: 'requested', origin: 'Profile page' }, NOW).line).toBe('from Profile page · Ann asks for your review');
    expect(changeNeed({ ...facts, task: 'tech', origin: 'Profile page' }, NOW).line).toBe('from Profile page · Ann asks for your tech review');
    expect(changeNeed({ ...facts, task: 'ship', origin: 'Profile page' }, NOW).line).toContain('from Profile page');
  });

  it('no origin, no line', () => {
    expect(changeNeed({ ...facts, task: 'requested' }, NOW).line).toBe('Ann asks for your review');
    expect(changeNeed({ ...facts, task: 'requested', origin: ' ' }, NOW).line).toBe('Ann asks for your review');
  });

  it("the viewer's own branch keeps its own line", () => {
    expect(changeNeed({ ...facts, task: 'own-ship', origin: 'Profile page' }, NOW).line).not.toContain('Profile page');
  });

  it('a suggestion says it too', () => {
    expect(suggestionNeed({ number: 8, title: 'T', createdAt: '2026-11-01T00:00:00Z', origin: 'Profile page' }, ann, NOW).line).toContain('from Profile page');
    expect(suggestionNeed({ number: 8, title: 'T', createdAt: '2026-11-01T00:00:00Z' }, ann, NOW).line).not.toContain('from');
  });
});

describe('on the demo', () => {
  const pull = (number: number, ref: string, body?: string): DemoPull => ({ number, title: `Change ${number}`, user: { login: 'ann' }, created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z', head: { ref }, body: body ?? null });
  const blue = 'bridge/deepen-the-primary-blue-for-stronger-buttons';

  it('the sample team reads its seeded origins', () => {
    const [row] = leadQueue([pull(13, blue)], [], NOW, { sample: true });
    expect(row?.line).toContain('from Profile page');
  });

  it('a sample change with no known origin has no line', () => {
    expect(leadQueue([pull(18, 'bridge/deprecate-color-bg-zone')], [], NOW, { sample: true })[0]?.line).not.toContain('from ');
  });

  it('the seed never reaches another team, whose real data still reads', () => {
    expect(leadQueue([pull(13, blue)], [], NOW)[0]?.line).not.toContain('from ');
    expect(leadQueue([pull(13, blue, withNeededBy('Body', needed))], [], NOW)[0]?.line).toContain('from Billing screen');
  });

  it('the seeds name a sample exploration, and every file they name ships with the site', () => {
    const file = (p: string) => new URL(`../../public${p}`, import.meta.url);
    for (const o of Object.values(SAMPLE_CHANGE_ORIGINS)) {
      expect(isSampleExploration(o.branch)).toBe(true);
    }
    for (const e of Object.values(SAMPLE_CHANGE_EFFECTS)) {
      if (e === 'none') continue;
      expect(existsSync(file(`${SAMPLE_EFFECTS_BASE}/${e.before}`))).toBe(true);
      expect(existsSync(file(`${SAMPLE_EFFECTS_BASE}/${e.after}`))).toBe(true);
    }
  });

  it('every effect belongs to a change with an origin', () => {
    for (const branch of Object.keys(SAMPLE_CHANGE_EFFECTS)) expect(sampleChangeOrigin(branch)).not.toBeNull();
  });
});
