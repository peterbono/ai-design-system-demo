// @vitest-environment jsdom
// The Studio page header, one pattern on every page: the title with the action on its line, ONE live summary sentence
// (no team name under the title), and no "How it works" fold (noise, often empty). No drawing in the header: the action
// comes first.
import '../../../../../../packages/react/src/test/setup';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { StudioHead } from './StudioHead';
import { QuietScene, SECTION_SCENES } from './QuietScene';
import { setPageSummary } from '../../../lib/page-summary';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Studio page header', () => {
  it('renders the title, one summary sentence and the action on the title line, with no drawing', async () => {
    const { container } = render(
      createElement(StudioHead, { title: 'Components', summary: '53 components in 8 families, each with usage guidance.', scene: 'components', actions: createElement('button', { type: 'button' }, 'Add guidance') }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Components' })).toBeTruthy();
    expect(container.querySelector('[data-st-summary]')!.textContent).toBe('53 components in 8 families, each with usage guidance.');
    expect(container.querySelector('.st-title-row [data-st-actions] button')!.textContent).toBe('Add guidance');
    // UX before brand: the primary action owns the end of the title line, no drawing competes with it.
    expect(container.querySelector('.st-head svg.qs')).toBeNull();
    expect(container.querySelectorAll('.st-head p')).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it('keeps More actions last on the title line, on a phone too, apart from the actions that move under the summary', () => {
    const { container } = render(
      createElement(StudioHead, {
        title: 'Art print shop',
        summary: 'Nothing explored here yet.',
        actions: createElement('button', { type: 'button' }, 'Start an exploration'),
        more: createElement('button', { type: 'button', 'aria-label': 'More actions for Art print shop' }),
      }),
    );
    const row = container.querySelector('.st-title-row')!;
    expect([...row.children].map((c) => c.className)).toEqual(['st-title', 'st-head-actions', 'st-head-more']);
    expect(row.querySelector('[data-st-more] button')!.getAttribute('aria-label')).toBe('More actions for Art print shop');
    // Phones: a two-column grid, the title wraps in the first column and More actions holds the end of its line.
    const css = read('../../../styles/studio-app.css');
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.st-head-main \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(phone).toMatch(/\.st-title-row > \.st-head-more \{[^}]*grid-row: 1;[^}]*grid-column: 2;/);
    // No empty place for a page without More actions.
    const { container: plain } = render(createElement(StudioHead, { title: 'Changes' }));
    expect(plain.querySelector('[data-st-more]')).toBeNull();
  });

  it('has no "How it works" fold under the title', () => {
    const { container } = render(createElement(StudioHead, { title: 'Being built', summary: '2 waiting to be picked up.', scene: 'building' }));
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain('How it works');
    // The summary sentence under the title stays.
    expect(container.querySelector('[data-st-summary]')!.textContent).toBe('2 waiting to be picked up.');
  });

  it('lets the page island write the live summary sentence', () => {
    const { container } = render(createElement(StudioHead, { title: 'Changes', scene: 'changes' }));
    setPageSummary('2 explorations running, 1 waiting for a developer.');
    expect(container.querySelector('[data-st-summary]')!.textContent).toBe('2 explorations running, 1 waiting for a developer.');
  });

  it('draws one scene per Studio section, each with something gently moving', () => {
    const moving: Record<(typeof SECTION_SCENES)[number], string> = {
      changes: '.qs-branch',
      building: '.qs-trolley .qs-hook',
      components: '.qs-float',
      tokens: '.qs-fan',
      settings: '.qs-wheel',
    };
    for (const scene of SECTION_SCENES) {
      const { container, unmount } = render(createElement(QuietScene, { scene, width: 160 }));
      const svg = container.querySelector(`svg.qs[data-scene="${scene}"]`)!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 160 96');
      expect(svg.querySelector(moving[scene]), scene).toBeTruthy();
      // Every stroke is drawn with pathLength 1, so the draw-in and the branches run the same on every line.
      for (const p of svg.querySelectorAll('path[stroke]')) expect(p.getAttribute('pathLength')).toBe('1');
      unmount();
    }
  });

  it('rests every moving part under reduced motion', () => {
    const css = read('../../../styles/quiet-scene.css');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const animated = [...css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce)')).matchAll(/^([^@\n{}][^{}\n]*)\{[^}]*\banimation:/gm)].flatMap((m) => m[1]!.split(',').map((x) => x.trim()));
    expect(animated.length).toBeGreaterThan(10);
    // The selectors of the first rule inside the media query (the one that sets animation: none).
    const inner = reduced.slice(reduced.indexOf('{') + 1);
    const still = inner.slice(0, inner.indexOf('{'));
    expect(inner.slice(inner.indexOf('{'), inner.indexOf('}'))).toContain('animation: none');
    for (const sel of animated) {
      const cls = sel.match(/\.qs-[a-z]+(?:-\d)?/)?.[0] ?? sel;
      // A numbered variant (.qs-branch-2, .qs-swell-2) rests with its family.
      const family = cls.replace(/-\d$/, '');
      expect(still.includes(family) || still.includes(sel), sel).toBe(true);
    }
    expect(reduced).toContain('animation: none');
  });
});

describe('Studio pages use the one header pattern', () => {
  const pages: [string, string][] = [
    ['../../../pages/studio/changes.astro', 'changes'],
    ['../../../pages/team-shell/changes.astro', 'changes'],
    ['../../../pages/studio/building.astro', 'building'],
    ['../../../pages/team-shell/building.astro', 'building'],
    ['../../../pages/studio/components/index.astro', 'components'],
    ['../../../pages/team-shell/components/index.astro', 'components'],
    ['../../explorer/TokenExplorer.astro', 'tokens'],
    ['../../../pages/studio/settings/index.astro', 'settings'],
    ['../../../pages/team-shell/settings/index.astro', 'settings'],
    ['../../../pages/studio/workspace/settings.astro', 'settings'],
  ];
  it.each(pages)('%s draws its section scene', (path, scene) => {
    expect(read(path)).toContain(`scene="${scene}"`);
  });

  it('Quality keeps its lighthouse in the verdict zone, not a second drawing in the header', () => {
    for (const page of ['../../../pages/studio/quality/index.astro', '../../../pages/team-shell/quality/index.astro']) expect(read(page)).not.toMatch(/scene="/);
  });

  it('never repeats the team name under the title', () => {
    expect(read('../../TeamShell.astro')).not.toContain('data-team-display');
  });

  it('no Studio page header carries a "How it works" fold', () => {
    for (const path of ['../../StudioHeader.astro', '../../TeamShell.astro', './StudioHead.tsx', '../../explorer/TokenExplorer.astro', ...pages.map(([p]) => p)]) {
      const src = read(path);
      expect(src, path).not.toContain('How it works');
      expect(src, path).not.toMatch(/slot="how"|st-how/);
    }
    expect(read('../../../styles/studio-app.css')).not.toContain('.st-how');
  });

  it('the header is not a Harbor zone', () => {
    expect(read('../../StudioHeader.astro')).not.toMatch(/class="[^"]*\bzone\b/);
    expect(read('./StudioHead.tsx')).not.toMatch(/className="[^"]*\bzone\b/);
  });
});
