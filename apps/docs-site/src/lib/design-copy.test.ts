import { describe, expect, it } from 'vitest';
import { claudeCodeUrl, copyAccessTarget, copyListed, COPY_WORDS, latestLine, madeLine, needsCopyAccess, showsBehind } from './design-copy';
import { productReposOfConfig } from './contribute';
import { productConnectionRow } from './settings-view';
import { takeItLines } from './explorations-view';

describe('the design team copy, in designer words', () => {
  it('never says fork, branch or repository, and never an em dash', () => {
    const all = [
      COPY_WORDS.intro('Art print shop'),
      COPY_WORDS.make,
      COPY_WORDS.making,
      ...(['ready', 'slow', 'turned-off', 'no-access', 'failed'] as const).map((r) => madeLine('Art print shop', r)),
      COPY_WORDS.behind('Art print shop'),
      COPY_WORDS.getLatest,
      ...(['ok', 'conflict', 'failed'] as const).map(latestLine),
      COPY_WORDS.noCopyStart('Art print shop'),
    ];
    for (const s of all) {
      expect(s).not.toMatch(/fork|branch|repositor|upstream|merge/i);
      expect(s).not.toMatch(/—/);
    }
    expect(COPY_WORDS.intro('Art print shop')).toBe("Get your own copy of Art print shop to explore in. The developers' code stays untouched.");
    expect(madeLine('Art print shop', 'turned-off')).toBe('Copies of Art print shop are turned off. Ask an admin to allow them.');
  });

  it('the quiet line shows only when the product moved on', () => {
    expect(showsBehind({ kind: 'ready', behind: 3 })).toBe(true);
    expect(showsBehind({ kind: 'ready', behind: 0 })).toBe(false);
    expect(showsBehind({ kind: 'ready', behind: null })).toBe(false);
    expect(showsBehind({ kind: 'missing' })).toBe(false);
    expect(showsBehind(null)).toBe(false);
  });

  it('Open in Claude Code: the copy selected, the first message naming the branch, the goal and the preview', () => {
    const url = new URL(claudeCodeUrl({ copy: 'the-bridge-company/art-print-shop-design', branch: 'explore/orders', name: 'Orders', purpose: 'Pack first', product: 'Art print shop', previewUrl: 'https://x.vercel.app' }));
    expect(url.origin + url.pathname).toBe('https://claude.ai/code');
    expect(url.searchParams.get('repositories')).toBe('the-bridge-company/art-print-shop-design');
    const prompt = url.searchParams.get('prompt')!;
    expect(prompt).toContain('Check out the branch explore/orders');
    expect(prompt).toContain('Goal: Pack first');
    expect(prompt).toContain('Its preview: https://x.vercel.app');
    expect(new URL(claudeCodeUrl({ copy: 'a/b', branch: 'explore/x', name: 'X', product: 'P' })).searchParams.get('prompt')).not.toContain('preview:');
  });

  it("the team's proxy reads the copy like the product's own repository", () => {
    expect(productReposOfConfig([{ repo: 'Acme/Shop', design: { repo: 'acme/shop-design' } }, { repo: 'acme/ds' }], 'acme/ds')).toEqual(['acme/shop', 'acme/shop-design']);
  });

  it('Settings says the copy is not made yet, and where to make it', () => {
    const row = productConnectionRow({ product: 'Art print shop', repo: 'acme/shop-design', state: 'no-copy', installLink: 'x' }, () => ({ label: '', message: '' }));
    expect(row.badge.text).toBe('No copy yet');
    expect(row.value).toContain('"Make my copy" on the Art print shop page');
    expect(row.ask).toBeNull();
  });

  it('developers take the code from the copy, into their own repository', () => {
    expect(takeItLines('explore/orders', 'acme/shop-design').commands).toEqual(['git fetch https://github.com/acme/shop-design.git explore/orders', 'git switch -c explore/orders FETCH_HEAD']);
    expect(takeItLines('explore/orders').commands).toEqual(['git fetch origin', 'git checkout explore/orders']);
  });
});

describe('what Bridge may open of a new copy', () => {
  const inst = (login: string, selection?: string) => ({ id: 7, account: { login, type: 'Organization' }, ...(selection ? { repository_selection: selection } : {}) });

  it('the copy account’s installation: every product, only the ticked ones, or not there', () => {
    expect(copyAccessTarget([inst('acme', 'all')], 'acme/shop-design')).toEqual({ kind: 'all' });
    expect(copyAccessTarget([inst('other', 'selected'), inst('ACME', 'selected')], 'acme/shop-design')).toEqual({ kind: 'selected', installation: inst('ACME', 'selected') });
    expect(copyAccessTarget([inst('other', 'selected')], 'acme/shop-design')).toEqual({ kind: 'none' });
    expect(copyAccessTarget([inst('acme')], 'acme/shop-design')).toEqual({ kind: 'all' });
  });

  it('a listed copy ignores case; the words never say fork, repository or installation', () => {
    expect(copyListed([{ full_name: 'Acme/Shop-Design' }], 'acme/shop-design')).toBe(true);
    expect(copyListed([{ full_name: 'acme/shop' }], 'acme/shop-design')).toBe(false);
    expect(COPY_WORDS.access('shop-design')).toBe('One more step: let Bridge open your copy. Tick shop-design on GitHub, then Save.');
    for (const w of [COPY_WORDS.access('x'), COPY_WORDS.accessWaiting('x'), COPY_WORDS.openGitHub]) expect(w).not.toMatch(/fork|repositor|installation|—/i);
    expect(needsCopyAccess({ kind: 'needs-access' })).toBe(true);
    expect(needsCopyAccess('ready')).toBe(false);
  });
});
