// @vitest-environment jsdom
// A team's Library shell: noindex unless the team opts in on a public repository, and the build-time links follow the
// team in the address.
import { afterEach, describe, expect, it } from 'vitest';
import { applyIndexing, markNoindex, pointLibraryLinks } from './library-team';

const robots = () => document.head.querySelectorAll('meta[name="robots"]');

describe('indexing', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('is noindex by default, once', () => {
    markNoindex();
    markNoindex();
    expect(robots()).toHaveLength(1);
    expect(robots()[0]!.getAttribute('content')).toBe('noindex');
  });

  it('opens to search engines only with library.public on a public repository', () => {
    markNoindex();
    applyIndexing({ public: false, private: false });
    expect(robots()).toHaveLength(1);
    applyIndexing({ public: true, private: true });
    expect(robots()).toHaveLength(1);
    applyIndexing({ public: true, private: false });
    expect(robots()).toHaveLength(0);
    // A later read that says otherwise closes it again.
    applyIndexing({ public: false, private: false });
    expect(robots()).toHaveLength(1);
  });
});

describe('pointLibraryLinks', () => {
  it('points the nav, Studio and GitHub links at the team', () => {
    document.body.innerHTML = `
      <a id="home" href="/library-shell/">Home</a>
      <a id="tokens" href="/library-shell/tokens/">Tokens</a>
      <a id="studio" href="/studio/">Open Studio</a>
      <a id="other" href="/studio/changes/">Changes</a>
      <a id="gh" href="https://github.com/peterbono/ai-design-system-demo" data-team-github>GitHub</a>
      <span data-team-name>owner/repo</span>`;
    const href = (id: string) => document.getElementById(id)!.getAttribute('href');
    pointLibraryLinks({ owner: 'acme', repo: 'ds' }, null);
    expect(href('home')).toBe('/library/acme/ds/');
    expect(href('tokens')).toBe('/library/acme/ds/tokens/');
    // Without the reserved list, the escape form, which always opens the team.
    expect(href('studio')).toBe('/studio/~/acme/ds/');
    expect(href('other')).toBe('/studio/changes/');
    expect(href('gh')).toBe('https://github.com/acme/ds');
    expect(document.querySelector('[data-team-name]')!.textContent).toBe('acme/ds');
    // With it, the plain address.
    pointLibraryLinks({ owner: 'acme', repo: 'ds' }, { firsts: [], pairs: [] });
    expect(href('studio')).toBe('/studio/acme/ds/');
    expect(href('home')).toBe('/library/acme/ds/');
  });
});
