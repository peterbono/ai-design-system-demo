import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './repo';
import { FAQ, STEP_MS, panoramaFit, stepForKey, stepTick } from './homepage';

describe('step tabs', () => {
  it('moves with arrows, wrapping, and jumps with Home and End', () => {
    expect(stepForKey('ArrowDown', 2)).toBe(0);
    expect(stepForKey('ArrowUp', 0)).toBe(2);
    expect(stepForKey('ArrowRight', 0)).toBe(1);
    expect(stepForKey('Home', 2)).toBe(0);
    expect(stepForKey('End', 0)).toBe(2);
    expect(stepForKey('Enter', 1)).toBeNull();
  });

  it('advances after the step time, never while paused, and ignores long frames', () => {
    expect(stepTick(STEP_MS - 10, 16, 2, false)).toEqual({ elapsed: 0, step: 0 });
    expect(stepTick(100, 16, 1, true)).toEqual({ elapsed: 100, step: 1 });
    expect(stepTick(0, 5000, 0, false)).toEqual({ elapsed: 64, step: 0 });
  });
});

describe('drawings', () => {
  it('centres the panorama, keeps it at 62% or more, with headroom for the carried card', () => {
    expect(panoramaFit(1440)).toEqual({ x: 0, y: 72, scale: 1, height: 364 });
    const phone = panoramaFit(390);
    expect(phone.scale).toBe(0.62);
    expect(phone.y).toBe(45);
    expect(phone.height).toBeCloseTo(292 * 0.62 + 45);
    expect(phone.x).toBeCloseTo((390 - 1440 * 0.62) / 2);
  });
});

describe('questions teams ask', () => {
  it('asks five questions, promises nothing planned, no em dash', () => {
    expect(FAQ.map((f) => f.question)).toEqual([
      'We already use Figma Code Connect. Why Bridge?',
      'Do I need to know Git?',
      'Do our developers have to change how they work?',
      'Does it work with our existing design system?',
      'Is Bridge open source?',
    ]);
    const all = JSON.stringify(FAQ);
    expect(all).not.toMatch(/planned|coming soon|\u2014/i);
    expect(all).toContain('npx @bridge-ds/cli init');
  });
});

describe('homepage sections', () => {
  const page = readFileSync(join(ROOT, 'apps/docs-site/src/pages/index.astro'), 'utf8');
  const footer = readFileSync(join(ROOT, 'apps/docs-site/src/components/site/SiteFooter.astro'), 'utf8');

  it('tells the hero as a drawn story, with no slider left, and keeps one call to action', () => {
    expect(page).toContain('<HpHeroScene />');
    expect(page).not.toMatch(/type="range"|data-range|data-hero|Drag: your|HpPencil|HpGhost|HpProfile/);
    expect(page).toContain('>Get started</ButtonLink>');
    expect(page).not.toContain('no account needed');
    const scene = readFileSync(join(ROOT, 'apps/docs-site/src/components/home/HpHeroScene.astro'), 'utf8');
    expect(scene).toMatch(/role="img" aria-label="Dana[^"]+Profile header[^"]+code and the Figma kit follow\."/);
    expect(scene).not.toMatch(/#[0-9a-f]{6}\b|\u2014/i);
    const css = readFileSync(join(ROOT, 'apps/docs-site/src/styles/home-hero.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s+\.hp-hxsv \.hp-fa \{\s+animation: none;/);
  });

  it('closes on a DS profile card that is one link to LinkedIn, with the facts unchanged', () => {
    expect(page).toContain('<HpConnectCard />');
    const card = readFileSync(join(ROOT, 'apps/docs-site/src/components/home/HpConnectCard.tsx'), 'utf8');
    expect(card).toContain("const NAME = 'Florian Gouloubi';");
    expect(card).toContain("const ROLE = 'Senior Product Designer';");
    expect(card).toContain("const LINKEDIN = 'https://www.linkedin.com/in/floriangouloubi/';");
    expect(card).toMatch(/<Card interactive/);
    expect(card).toMatch(/<Avatar name=\{NAME\} size="lg" decorative \/>/);
    // One interactive element: the Connect link, stretched over the card; its name starts with its visible text.
    expect(card.match(/<ButtonLink\b/g)).toHaveLength(1);
    expect(card).not.toMatch(/<(a|button|Button|Link)\b/);
    expect(card).toContain('data-card-primary');
    expect(card).toContain('aria-label={`Connect on LinkedIn with ${NAME} (opens in a new tab)`}');
    expect(card).toMatch(/>\s+Connect on LinkedIn\s+</);
    expect(card).not.toMatch(/\u2014/);
  });

  it('starts in Bridge, then ships, then the system everyone can trust', () => {
    const titles = [...page.matchAll(/<HpStepSection[\s\S]*?title="([^"]+)"/g)].map((m) => m[1]);
    expect(titles).toEqual(['Start it in Bridge. Every change is tracked.', 'Ship it everywhere at once.', 'One system everyone can trust.']);
    expect(page).not.toContain('title="Keep what works."');
    // Text left, then panel left, then text left again.
    const flips = [...page.matchAll(/<HpStepSection\s+id="[^"]+"\s+(flip\s+)?title=/g)].map((m) => Boolean(m[1]));
    expect(flips).toEqual([false, true, false]);
    expect(page).toContain('lede="Explore with Claude AI as usual. Bridge tracks what it changes in your system."');
    expect(page).not.toMatch(/—/);
  });

  it('shows the dialog, then the sieve, then the sign-off: Field Guide drawings, no interface with buttons', () => {
    expect(page).toMatch(/slot="p0" class="hp-card hp-dlg"/);
    expect(page).toContain('<HpSieve />');
    expect(page).toContain('<HpSignoff />');
    for (const f of ['HpSieve', 'HpSignoff']) {
      const src = readFileSync(join(ROOT, `apps/docs-site/src/components/home/${f}.astro`), 'utf8');
      expect(src).not.toMatch(/hp-obtn|<Button|<button/);
      expect(src).not.toMatch(/#[0-9a-f]{6}/i);
    }
  });

  it('puts the lead board, then the comparison and the questions, right before the closing', () => {
    const lead = page.indexOf('<HpLead');
    const faq = page.indexOf('<HpFaq client:visible');
    expect(lead).toBeGreaterThan(0);
    const cmp = page.indexOf('<HpCompare');
    expect(cmp).toBeGreaterThan(lead);
    expect(faq).toBeGreaterThan(cmp);
    expect(faq).toBeLessThan(page.indexOf('class="hp-closing"'));
  });

  it('draws Ship and Trust as Field Guide illustrations, with no interface mock-ups left', () => {
    for (const c of ['HpShipMerge', 'HpShipCode', 'HpShipPlugin', 'HpTrustLib', 'HpTrustTwin', 'HpTrustQuality']) expect(page).toContain(`<${c} />`);
    expect(page).not.toMatch(/hp-mcard|hp-cpage|hp-plug|hp-qual|HpQueue/);
  });

  it('keeps the footer About column to About Bridge and GitHub', () => {
    expect(footer).not.toContain('npmjs.com');
    expect(footer).toContain("label: 'About Bridge'");
  });
});
