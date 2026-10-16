import { describe, expect, it } from 'vitest';
import { shouldBuild } from './vercel-ignore.mjs';

describe('vercel-ignore shouldBuild', () => {
  it('builds an app when its own files or shared packages change', () => {
    expect(shouldBuild('docs', ['apps/docs-site/src/pages/index.astro'])).toBe(true);
    expect(shouldBuild('admin', ['packages/react/src/components/Button/Button.tsx'])).toBe(true);
    expect(shouldBuild('storybook', ['.storybook/preview.tsx'])).toBe(true);
    expect(shouldBuild('storybook', ['package-lock.json'])).toBe(true);
  });

  it('skips an app when only another app changed', () => {
    expect(shouldBuild('admin', ['apps/docs-site/src/pages/index.astro', 'docs/GOVERNANCE.md'])).toBe(false);
    expect(shouldBuild('storybook', ['apps/admin/src/App.tsx'])).toBe(false);
    expect(shouldBuild('docs', ['apps/admin/src/App.tsx', 'deploy/storybook/vercel.json'])).toBe(false);
    expect(shouldBuild('docs', [])).toBe(false);
  });

  it('matches whole path segments and exact files, and always builds unknown apps', () => {
    expect(shouldBuild('admin', ['apps/admin-legacy/x.ts'])).toBe(false);
    expect(shouldBuild('admin', ['package.json.bak'])).toBe(false);
    expect(shouldBuild('nope', [])).toBe(true);
  });
});
