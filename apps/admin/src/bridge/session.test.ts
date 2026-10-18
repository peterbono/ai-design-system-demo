import { describe, expect, it } from 'vitest';
import {
  changedScreens,
  changeMode,
  dockAt,
  isFlipKey,
  isPreviewUrl,
  noVisibleDifference,
  changeSummary,
  designerName,
  roleOfToken,
  stepOfToken,
  tokenChanges,
  toHex,
  contrastRatio,
  isSubtle,
  placeToolbar,
  readableTitle,
  readChange,
  readDock,
  readReturn,
  readScroll,
  RETURN_KEY,
  sameScreenOn,
  SESSION_KEY,
  liveTokensUrl,
  shouldRender,
  stepDock,
  studioChangeUrl,
  whereAmI,
  type ManifestShot,
  type StorageLike,
} from './session';

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const TEMPLATE = 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app';
const build = {
  owner: 'peterbono',
  repo: 'ai-design-system-demo',
  studio: 'https://bridge.floriangouloubi.com',
  productionAdmin: 'https://bridge-demo.floriangouloubi.com',
  adminTemplate: TEMPLATE,
  deployEnv: null,
};

describe('readChange', () => {
  it('takes ?bridge=<n> and keeps it for the session', () => {
    const s = memoryStorage();
    expect(readChange('?bridge=101&tenant=northwind', s)).toBe(101);
    expect(s.data.get(SESSION_KEY)).toBe('101');
    expect(readChange('?tenant=northwind', s)).toBe(101);
  });

  it('forgets it on ?bridge=off and ignores anything that is not a change number', () => {
    const s = memoryStorage({ [SESSION_KEY]: '101' });
    expect(readChange('?bridge=off', s)).toBeNull();
    expect(s.data.has(SESSION_KEY)).toBe(false);
    expect(readChange('?bridge=<script>', memoryStorage())).toBeNull();
    expect(readChange('?bridge=0', memoryStorage())).toBeNull();
    expect(readChange('', memoryStorage({ [SESSION_KEY]: 'abc' }))).toBeNull();
  });

  it('still shows the toolbar of the current page when storage is blocked', () => {
    expect(readChange('?bridge=7', throwing)).toBe(7);
    expect(readChange('', throwing)).toBeNull();
    expect(readChange('?bridge=7', null)).toBe(7);
  });
});

describe('where the toolbar shows', () => {
  it('tells production from previews and local builds', () => {
    expect(whereAmI('bridge-demo.floriangouloubi.com', build)).toBe('production');
    expect(whereAmI('anything.example', { ...build, deployEnv: 'production' })).toBe('production');
    expect(whereAmI('bridge-admin-git-x-peterbonos-projects.vercel.app', { ...build, deployEnv: 'preview' })).toBe('preview');
    expect(whereAmI('localhost:5180', build)).toBe('local');
  });

  it('never renders without a change, and on production only with a preview to return to', () => {
    expect(shouldRender({ change: null, where: 'preview', returnTo: null })).toBe(false);
    expect(shouldRender({ change: 101, where: 'preview', returnTo: null })).toBe(true);
    expect(shouldRender({ change: 101, where: 'local', returnTo: null })).toBe(true);
    expect(shouldRender({ change: 101, where: 'production', returnTo: null })).toBe(false);
    expect(shouldRender({ change: 101, where: 'production', returnTo: 'https://bridge-admin-git-a-peterbonos-projects.vercel.app' })).toBe(true);
  });
});

describe('isPreviewUrl and readReturn', () => {
  it('accepts only hosts the admin preview template produces, over https', () => {
    expect(isPreviewUrl('https://bridge-admin-git-tokens-color-bg-def-b58ff0-peterbonos-projects.vercel.app/', TEMPLATE)).toBe(true);
    expect(isPreviewUrl('http://bridge-admin-git-a-peterbonos-projects.vercel.app', TEMPLATE)).toBe(false);
    expect(isPreviewUrl('https://evil.vercel.app', TEMPLATE)).toBe(false);
    expect(isPreviewUrl('https://bridge-admin-git-a-peterbonos-projects.vercel.app.evil.com', TEMPLATE)).toBe(false);
    expect(isPreviewUrl('https://user@bridge-admin-git-a-peterbonos-projects.vercel.app', TEMPLATE)).toBe(false);
    expect(isPreviewUrl('not a url', TEMPLATE)).toBe(false);
    expect(isPreviewUrl('https://bridge-admin-git-a-peterbonos-projects.vercel.app', null)).toBe(false);
  });

  it('keeps a valid return origin for the session and refuses others', () => {
    const s = memoryStorage();
    const url = 'https://bridge-admin-git-a-peterbonos-projects.vercel.app/?x=1';
    expect(readReturn(`?bridge-return=${encodeURIComponent(url)}`, s, TEMPLATE)).toBe('https://bridge-admin-git-a-peterbonos-projects.vercel.app');
    expect(readReturn('', s, TEMPLATE)).toBe('https://bridge-admin-git-a-peterbonos-projects.vercel.app');
    expect(readReturn('?bridge-return=https://evil.com', memoryStorage(), TEMPLATE)).toBeNull();
    expect(readReturn('', memoryStorage({ [RETURN_KEY]: 'https://evil.com' }), TEMPLATE)).toBeNull();
  });
});

describe('changeMode', () => {
  it('is tokens when only token files and changesets change, code otherwise', () => {
    expect(changeMode(['packages/tokens/src/semantic/light.tokens.json', '.changeset/bg.md'])).toBe('tokens');
    expect(changeMode(['packages/tokens/src/contrast.checks.json'])).toBe('tokens');
    expect(changeMode(['packages/tokens/src/semantic/light.tokens.json', 'packages/react/src/components/Button/Button.module.css'])).toBe('code');
    expect(changeMode([])).toBe('code');
  });
});

describe('links', () => {
  it('serves the shipped tokens from production Studio and links back to the change', () => {
    expect(liveTokensUrl(build)).toBe('https://bridge.floriangouloubi.com/tokens.css');
    expect(liveTokensUrl({ studio: 'https://x.example/docs/' })).toBe('https://x.example/docs/tokens.css');
    expect(liveTokensUrl({ studio: null })).toBeNull();
    expect(studioChangeUrl(build, 101)).toBe('https://bridge.floriangouloubi.com/studio/changes/?pr=101');
    expect(studioChangeUrl({ ...build, studio: null }, 101)).toBe('https://github.com/peterbono/ai-design-system-demo/pull/101');
  });

  it('opens the same screen on the other deployment, with the change, the way back and the scroll', () => {
    const here = { search: '?bridge=101&tenant=harbor&theme=dark&bridge-scroll=10', hash: '#/orders/12' };
    const before = sameScreenOn(build.productionAdmin, here, { change: 101, returnTo: 'https://bridge-admin-git-a-peterbonos-projects.vercel.app', scroll: 420.4 });
    const u = new URL(before);
    expect(u.origin).toBe('https://bridge-demo.floriangouloubi.com');
    expect(u.hash).toBe('#/orders/12');
    expect(u.searchParams.get('tenant')).toBe('harbor');
    expect(u.searchParams.get('bridge')).toBe('101');
    expect(u.searchParams.get('bridge-return')).toBe('https://bridge-admin-git-a-peterbonos-projects.vercel.app');
    expect(u.searchParams.get('bridge-scroll')).toBe('420');
    const after = new URL(sameScreenOn('https://bridge-admin-git-a-peterbonos-projects.vercel.app', { search: u.search, hash: u.hash }, { change: 101 }));
    expect(after.searchParams.has('bridge-return')).toBe(false);
    expect(after.searchParams.has('bridge-scroll')).toBe(false);
    expect(readScroll('?bridge-scroll=420')).toBe(420);
    expect(readScroll('?bridge-scroll=-1')).toBeNull();
  });
});

describe('changedScreens', () => {
  const shot = (o: Partial<ManifestShot>): ManifestShot => ({ kind: 'route', label: 'Orders list', route: '/orders', tenant: 'northwind', theme: 'light', status: 'changed', percent: 10, ...o });
  it('lists changed admin screens, most changed first, once per screen, shop and theme', () => {
    const screens = changedScreens([
      shot({ label: 'Dashboard', route: '/', percent: 20.43 }),
      shot({ label: 'Order edit', route: '/orders/12', percent: 30.21 }),
      shot({ label: 'Reviews', route: '/reviews/4', status: 'unchanged', percent: 0 }),
      shot({ kind: 'story', label: 'Data display/Divider: All States', route: undefined, percent: 99 }),
      shot({ label: 'Order edit', route: '/orders/12', percent: 1 }),
      shot({ label: 'Order edit', route: '/orders/12', theme: 'dark', percent: 5 }),
    ]);
    expect(screens.map((s) => `${s.label} ${s.theme}`)).toEqual(['Order edit light', 'Dashboard light', 'Order edit dark']);
    expect(changedScreens(null)).toEqual([]);
  });
});

describe('dock and keys', () => {
  it('docks by thirds, steps within the edges and reads a safe default', () => {
    expect(dockAt(100, 1440)).toBe('start');
    expect(dockAt(720, 1440)).toBe('center');
    expect(dockAt(1300, 1440)).toBe('end');
    expect(stepDock('start', -1)).toBe('start');
    expect(stepDock('center', 1)).toBe('end');
    expect(readDock(memoryStorage({ 'bridge-admin:toolbar-dock': 'end' }))).toBe('end');
    expect(readDock(memoryStorage({ 'bridge-admin:toolbar-dock': 'top' }))).toBe('end');
    expect(readDock(throwing)).toBe('end');
  });

  it('flips on B, never while typing or with a modifier', () => {
    const key = (key: string, target: unknown = null, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, target, ...mods });
    expect(isFlipKey(key('b'))).toBe(true);
    expect(isFlipKey(key('B'))).toBe(true);
    expect(isFlipKey(key('b', null, { metaKey: true }))).toBe(false);
    expect(isFlipKey(key('b', { tagName: 'INPUT' }))).toBe(false);
    expect(isFlipKey(key('b', { tagName: 'DIV', isContentEditable: true }))).toBe(false);
    expect(isFlipKey(key('b', { tagName: 'DIV', closest: () => ({}) }))).toBe(false);
    expect(isFlipKey(key('b', { tagName: 'BUTTON', closest: () => null }))).toBe(true);
    expect(isFlipKey(key('a'))).toBe(false);
  });

  it('reads titles like people do', () => {
    expect(readableTitle('tokens: darker default background')).toBe('Darker default background');
    expect(readableTitle('feat(card)!: lift cards')).toBe('Lift cards');
    expect(readableTitle('Plain title')).toBe('Plain title');
  });
});

describe('placeToolbar', () => {
  const base = { left: 256, right: 1424, vh: 900, w: 600, h: 80, gutter: 16 };
  it('keeps the chosen dock when nothing is in the way', () => {
    expect(placeToolbar({ ...base, preferred: 'end', obstacles: [] })).toEqual({ dock: 'end', lift: 0 });
  });

  it('moves to the opposite corner of the content column when it would cover a primary button', () => {
    const save = { left: 1200, top: 804, right: 1344, bottom: 848 };
    expect(placeToolbar({ ...base, preferred: 'end', obstacles: [save] })).toEqual({ dock: 'start', lift: 0 });
  });

  it('never leaves the content column', () => {
    const save = { left: 300, top: 804, right: 500, bottom: 848 };
    const both = [save, { left: 1300, top: 804, right: 1400, bottom: 848 }];
    expect(placeToolbar({ ...base, w: 300, preferred: 'start', obstacles: both }).dock).toBe('center');
  });

  it('rises above the buttons when every dock covers one (a full width sticky bar on a phone)', () => {
    const bar = { left: 8, top: 780, right: 382, bottom: 828 };
    const r = placeToolbar({ left: 8, right: 382, vh: 844, w: 374, h: 52, gutter: 8, preferred: 'end', obstacles: [bar] });
    expect(r.dock).toBe('end');
    // The toolbar's bottom (844 - 8 - lift) sits at least 8px above the bar's top (780).
    expect(844 - 8 - r.lift).toBeLessThanOrEqual(780 - 8);
  });
});

describe('noVisibleDifference', () => {
  const light = ['packages/tokens/src/semantic/light.tokens.json', '.changeset/x.md'];
  it('says a light only change shows nothing in dark, from the token layers it edits', () => {
    expect(noVisibleDifference(light, { theme: 'dark', brand: 'bridge' })).toEqual({ kind: 'theme', here: 'dark', touched: 'light' });
    expect(noVisibleDifference(light, { theme: 'light', brand: 'ocean' })).toBeNull();
  });

  it('tells brand only changes apart', () => {
    const ocean = ['packages/tokens/src/brands/ocean.tokens.json'];
    expect(noVisibleDifference(ocean, { theme: 'light', brand: 'bridge' })).toEqual({ kind: 'brand', here: 'bridge', touched: 'ocean' });
    expect(noVisibleDifference(['packages/tokens/src/brands/ocean.dark.tokens.json'], { theme: 'light', brand: 'ocean' })).toEqual({ kind: 'theme', here: 'light', touched: 'dark' });
  });

  it('never claims no difference when a shared layer changes or nothing tells', () => {
    expect(noVisibleDifference(['packages/tokens/src/primitives/color.tokens.json', ...light], { theme: 'dark', brand: 'bridge' })).toBeNull();
    expect(noVisibleDifference(['packages/tokens/src/semantic/base.tokens.json'], { theme: 'dark', brand: 'bridge' })).toBeNull();
    expect(noVisibleDifference(['.changeset/x.md'], { theme: 'dark', brand: 'bridge' })).toBeNull();
    expect(noVisibleDifference([], { theme: 'dark', brand: 'bridge' })).toBeNull();
  });
});

describe('token diff', () => {
  const file = 'packages/tokens/src/semantic/light.tokens.json';
  const v = (value: string, description = 'Page canvas. White in bridge, so content sits on paper.') => ({
    color: { $type: 'color', bg: { default: { $value: value, $description: description }, subtle: { $value: '{palette.neutral.50}' } } },
  });
  it('lists the tokens whose value changed, with their CSS variable, designer name and theme', () => {
    expect(tokenChanges(file, v('{palette.neutral.0}'), v('{palette.neutral.50}'))).toEqual([
      { path: 'color.bg.default', cssVar: '--color-bg-default', name: 'Page canvas', step: null, type: 'color', theme: 'light', brand: null },
    ]);
    expect(tokenChanges(file, v('{palette.neutral.0}'), v('{palette.neutral.0}', 'New words only'))).toEqual([]);
  });

  it('counts added and removed tokens, and ignores changesets', () => {
    expect(tokenChanges(file, null, v('{palette.neutral.0}')).map((t) => t.path)).toEqual(['color.bg.default', 'color.bg.subtle']);
    expect(tokenChanges('.changeset/a.md', null, v('x'))).toEqual([]);
  });

  it('names tokens like designers do and reads colours as hex', () => {
    expect(designerName('color.text.muted', 'Secondary text.')).toBe('Secondary text');
    expect(designerName('color.bg.default', null)).toBe('Bg default');
    expect(designerName('palette.primary.700', null)).toBe('Primary 700');
    expect(toHex('rgb(245, 247, 249)')).toBe('#f5f7f9');
    expect(toHex('rgba(0, 0, 0, 0.5)')).toBe('#00000080');
    expect(toHex('16px')).toBe('16px');
  });

  it('turns the change title into the phrase after "This change:"', () => {
    expect(changeSummary('tokens: darker default background')).toBe('darker default background.');
    expect(changeSummary('CTA buttons.')).toBe('CTA buttons.');
  });
});

describe('subtle colour changes', () => {
  it('measures contrast between the two sides and flags near-identical colours', () => {
    expect(contrastRatio('rgb(255, 255, 255)', 'rgb(0, 0, 0)')).toBeCloseTo(21, 0);
    expect(contrastRatio('rgb(255, 255, 255)', 'rgb(245, 247, 249)')).toBeLessThan(1.1);
    expect(isSubtle('rgb(255, 255, 255)', 'rgb(245, 247, 249)')).toBe(true);
    expect(isSubtle('rgb(11, 74, 139)', 'rgb(3, 98, 82)')).toBe(false);
    expect(contrastRatio('12px', '16px')).toBeNull();
    expect(isSubtle('12px', '16px')).toBe(false);
  });
});

describe('token roles', () => {
  it('leads with the role a change edits, the palette step second', () => {
    expect(roleOfToken('palette.primary.700', null)).toBe('Brand primary');
    expect(roleOfToken('palette.link.600', null)).toBe('Link');
    expect(roleOfToken('color.text.muted', 'Secondary text.')).toBe('Secondary text');
    expect(stepOfToken('palette.primary.700')).toBe('Primary 700');
    expect(stepOfToken('color.bg.default')).toBeNull();
    const [t] = tokenChanges('packages/tokens/src/brands/bridge.tokens.json', { palette: { primary: { 700: { $value: '{color.harbor.700}' } } } }, { palette: { primary: { 700: { $value: '{color.teal.700}' } } } });
    expect(t).toMatchObject({ name: 'Brand primary', step: 'Primary 700', theme: null, brand: 'bridge', cssVar: '--palette-primary-700' });
  });
});
