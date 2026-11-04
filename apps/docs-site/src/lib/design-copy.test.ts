import { describe, expect, it } from 'vitest';
import {
  afterCopyFirst,
  claudeCodeUrl,
  copyAccessTarget,
  copyListed,
  COPY_SETUP_MAX_MS,
  COPY_SETUP_WORDS,
  COPY_WORDS,
  copySetupFresh,
  copySetupKey,
  latestLine,
  needsCopyAccess,
  noteCopySetup,
  setupLine,
  showsBehind,
  startCopyLine,
  type CopyAccess,
} from './design-copy';
import { productReposOfConfig } from './contribute';
import { productConnectionRow } from './settings-view';
import { takeItLines } from './explorations-view';
import { PRODUCTS_COPY_LINE } from './onboarding';

const OUTCOMES = ['slow', 'turned-off', 'no-access', 'failed', 'ask'] as const;

describe('the design team copy, in designer words', () => {
  it('never says fork, branch or repository, never an em dash, and never "Make my copy"', () => {
    const all = [
      COPY_WORDS.making,
      COPY_WORDS.startMaking('Art print shop'),
      COPY_SETUP_WORDS.making,
      COPY_SETUP_WORDS.tryAgain,
      ...OUTCOMES.map((r) => setupLine('Art print shop', r)),
      ...OUTCOMES.map((r) => startCopyLine('Art print shop', r)),
      COPY_WORDS.behind('Art print shop'),
      COPY_WORDS.getLatest,
      ...(['ok', 'conflict', 'failed'] as const).map(latestLine),
      PRODUCTS_COPY_LINE,
    ];
    for (const s of all) {
      expect(s).not.toMatch(/fork|branch|repositor|upstream|merge/i);
      expect(s).not.toMatch(/—/);
      expect(s).not.toMatch(/make my copy/i);
    }
    expect(COPY_SETUP_WORDS.making).toBe('Getting a copy ready for your designers…');
    expect(COPY_WORDS.startMaking('Art print shop')).toBe('Getting Art print shop ready to explore. It takes about a minute.');
    expect(startCopyLine('Art print shop', 'turned-off')).toBe('Copies of Art print shop are turned off. Ask an admin to allow them.');
    expect(setupLine('Art print shop', 'failed')).toBe('Bridge could not get a copy ready for your designers.');
  });

  it('Start an exploration after making the copy first: start, the access step for an admin only, or why it waits', () => {
    const access: CopyAccess = { kind: 'needs-access', copy: 'acme/shop-design', name: 'shop-design', installation: { id: 7, account: { login: 'acme', type: 'Organization' } } };
    expect(afterCopyFirst('ready', false)).toEqual({ kind: 'start' });
    expect(afterCopyFirst(access, true)).toEqual({ kind: 'access', access });
    const designer = afterCopyFirst(access, false);
    expect(designer.kind).toBe('say');
    if (designer.kind === 'say') expect(designer.line('Shop')).toBe(startCopyLine('Shop', 'ask'));
    const slow = afterCopyFirst('slow', true);
    if (slow.kind !== 'say') throw new Error('expected a line');
    expect(slow.line('Shop')).toBe('Shop is still getting ready. Try again in a minute.');
  });

  it('the copy to make after Add a product: per team and product, forgotten after half an hour', () => {
    expect(copySetupKey('Acme/DS', 'Shop')).toBe('bridge:copy-setup:acme/ds:shop');
    const now = 1_000_000_000;
    expect(copySetupFresh(JSON.stringify({ at: now - 1000 }), now)).toBe(true);
    expect(copySetupFresh(JSON.stringify({ at: now - COPY_SETUP_MAX_MS }), now)).toBe(false);
    expect(copySetupFresh(JSON.stringify({ at: now + 1000 }), now)).toBe(false);
    expect(copySetupFresh('not json', now)).toBe(false);
    expect(copySetupFresh(null, now)).toBe(false);
    const kept = new Map<string, string>();
    noteCopySetup({ setItem: (k, v) => kept.set(k, v) }, 'acme/ds', 'shop', now);
    expect(copySetupFresh(kept.get('bridge:copy-setup:acme/ds:shop'), now + 1000)).toBe(true);
    // Storage refused (a private window): nothing breaks, the first exploration makes the copy instead.
    expect(() =>
      noteCopySetup(
        {
          setItem: () => {
            throw new Error('refused');
          },
        },
        'acme/ds',
        'shop',
        now,
      ),
    ).not.toThrow();
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

  it('Settings says the copy is not made yet, and that Bridge makes it, never a "Make my copy" to find', () => {
    const row = productConnectionRow({ product: 'Art print shop', repo: 'acme/shop-design', state: 'no-copy', installLink: 'x' }, () => ({ label: '', message: '' }));
    expect(row.badge.text).toBe('No copy yet');
    expect(row.value).toContain('Bridge makes it when the first exploration of Art print shop starts.');
    expect(row.value).not.toContain('Make my copy');
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
    expect(COPY_WORDS.access('shop-design')).toBe("One more step: let Bridge open the designers' copy. Tick shop-design on GitHub, then Save.");
    for (const w of [COPY_WORDS.access('x'), COPY_WORDS.accessWaiting('x'), COPY_WORDS.openGitHub]) expect(w).not.toMatch(/fork|repositor|installation|—/i);
    expect(needsCopyAccess({ kind: 'needs-access' })).toBe(true);
    expect(needsCopyAccess('ready')).toBe(false);
  });
});
