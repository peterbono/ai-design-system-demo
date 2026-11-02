import { describe, expect, it } from 'vitest';
import { commentBody, globToRegExp, loadMap, MARKER, normalizeError, planScreens, renderErrors, rewrite, variantsOf, verdict } from './screens.mjs';

const map = loadMap();

describe('screens: the map', () => {
  it('names only screens it defines, and only the sample team or public pages', () => {
    for (const id of [...map.default, ...map.rules.flatMap((r) => r.screens)]) expect(map.screens[id], id).toBeDefined();
    for (const s of Object.values(map.screens)) {
      if (s.email) continue;
      // Privacy: never a private team or product, only the sample team and the public site.
      if (s.path.startsWith('/studio/') || s.path.startsWith('/library/')) expect(s.path).toMatch(/^\/(studio|library)\/peterbono\/bridge-demo-ds\//);
    }
  });

  it('matches globs like the workflow paths', () => {
    expect(globToRegExp('apps/docs-site/src/components/**').test('apps/docs-site/src/components/ds/studio/X.tsx')).toBe(true);
    expect(globToRegExp('apps/docs-site/src/scripts/product-*.ts').test('apps/docs-site/src/scripts/product-page.ts')).toBe(true);
    expect(globToRegExp('apps/docs-site/src/scripts/product-*.ts').test('apps/docs-site/src/scripts/x/product-page.ts')).toBe(false);
  });
});

describe('screens: which screens a change shows', () => {
  it('maps a known component to its screen, first, and an unknown UI file to the default set', () => {
    const p = planScreens(['apps/docs-site/src/lib/anything.ts', 'apps/docs-site/src/components/ds/studio/ProductPage.tsx'], map);
    expect(p.screens[0]).toBe('product');
    expect(p.screens).toEqual(expect.arrayContaining(map.default));
    expect(p.why.product).toContain('apps/docs-site/src/components/ds/studio/ProductPage.tsx');
  });

  it('renders the email fixtures for notify-mail, and nothing for tests or stories', () => {
    expect(planScreens(['apps/docs-site/api/_lib/notify-mail.ts'], map).screens).toEqual(['email-instant', 'email-digest']);
    expect(planScreens(['apps/docs-site/src/components/ds/studio/ProductPage.test.ts', 'packages/react/src/components/Button/Button.stories.tsx', 'README.md'], map).screens).toEqual([]);
  });

  it('keeps at most maxScreens and says which were left out', () => {
    const files = map.rules.flatMap((r) => r.files.filter((f) => !f.includes('*')));
    const p = planScreens(files, { ...map, maxScreens: 3 });
    expect(p.screens).toHaveLength(3);
    expect(p.dropped.length).toBeGreaterThan(0);
  });
});

describe('screens: the static server rewrites like vercel.json', () => {
  const reserved = new Set(['changes', 'settings', 'products']);
  it('serves team addresses from the team shell, products from one shell', () => {
    expect(rewrite('/studio/peterbono/bridge-demo-ds/', reserved)).toBe('/team-shell/');
    expect(rewrite('/studio/peterbono/bridge-demo-ds/changes/', reserved)).toBe('/team-shell/changes/');
    expect(rewrite('/studio/peterbono/bridge-demo-ds/products/account/', reserved)).toBe('/team-shell/products/item/');
    expect(rewrite('/library/peterbono/bridge-demo-ds/components/button/', reserved)).toBe('/library-shell/components/item/');
  });
  it('leaves real Studio pages alone', () => {
    expect(rewrite('/studio/settings/general', reserved)).toBeNull();
    expect(rewrite('/docs/', reserved)).toBeNull();
  });
});

const v = (o = {}) => ({ screen: 'home', viewport: 'mobile', theme: 'light', consoleErrors: [], pageErrors: [], ...o });

describe('screens: the verdict', () => {
  it('fails on a crash, a console error or horizontal scroll at 390 px', () => {
    expect(renderErrors(v())).toEqual([]);
    expect(renderErrors(v({ crash: 'Timeout' }))).toHaveLength(1);
    expect(renderErrors(v({ consoleErrors: ['TypeError: x is undefined'] }))[0]).toMatch(/^console: TypeError/);
    expect(renderErrors(v({ overflow: { scrollWidth: 420, offenders: ['div.row (420 px)'] } }))[0]).toMatch(/horizontal scroll at 390 px/);
  });

  it('fails only on what the pull request adds: errors main already has are warnings', () => {
    const after = { variants: [v({ consoleErrors: ['Old error at http://127.0.0.1:4173/a.js:1:2'] }), v({ theme: 'dark', overflow: { scrollWidth: 400 } })] };
    const before = { variants: [v({ consoleErrors: ['Old error at http://127.0.0.1:4173/a.js:9:9'] }), v({ theme: 'dark' })] };
    const r = verdict(after, before);
    expect(r.failures.map((f) => f.where)).toEqual(['home, mobile dark']);
    expect(r.warnings[0].text).toMatch(/already on main/);
  });

  it('lists axe violations as warnings, never failures', () => {
    const r = verdict({ variants: [v({ axe: [{ id: 'color-contrast', impact: 'serious', nodes: 2, help: 'Contrast' }] })] }, null);
    expect(r.failed).toBe(false);
    expect(r.warnings).toHaveLength(1);
  });

  it('compares errors without ports or line numbers', () => {
    expect(normalizeError('X at http://localhost:4173/_astro/page.AbCdEf12.js:10:5')).toBe(normalizeError('X at http://localhost:5000/_astro/page.ZyXwVu98.js:3:1'));
  });
});

describe('screens: the comment', () => {
  it('starts with the sticky marker, shows changed screens open with their base images', () => {
    const variants = variantsOf({}).map(({ viewport, theme }) => v({ viewport, theme, webp: `home-${viewport}-${theme}.webp`, diff: { ratio: viewport === 'desktop' ? 0.03 : 0 } }));
    const after = { variants, labels: { home: 'Studio home' }, paths: { home: '/studio/peterbono/bridge-demo-ds/' }, why: { home: ['apps/docs-site/src/components/ds/studio/StudioHome.tsx'] } };
    const body = commentBody({ after, before: { variants }, check: verdict(after, { variants }), pr: 3, sha: 'abcdef123', baseSha: '1234567', rawBase: 'https://raw.githubusercontent.com/o/r/bridge-shots/pr-3/abcdef1' });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('<details open><summary><b>Studio home</b> · changed in 2 of 4 views');
    expect(body).toContain('/before/home-desktop-light.webp');
    expect(body).not.toContain('/before/home-mobile-light.webp');
    expect(body).not.toContain(String.fromCharCode(0x2014));
  });
});
