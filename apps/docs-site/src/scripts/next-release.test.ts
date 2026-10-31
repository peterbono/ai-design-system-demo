// @vitest-environment jsdom
// Being built > the next release (scripts/next-release.ts): only whoever may publish sees it, the release pull request
// is read only for them, and its body (written by the changesets action from changeset summaries) stays text.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const IMG = '<img src=x onerror=alert(1)>';
const body = `## @bridge-ds/react@1.2.0\n\n### Minor Changes\n\n- abc1234: ${IMG}\n\n## ${IMG}@9.9.9\n\n### Patch Changes\n\n- def5678: fix`;

const state = { viewer: 'ana' as string | null, holders: ['ana'], reads: 0 };

vi.mock('./github-session', async (orig) => ({
  ...(await orig<typeof import('./github-session')>()),
  initGitHubConnect: () => {},
  hasWorkingToken: () => state.viewer !== null,
  currentViewer: () => (state.viewer ? { login: state.viewer } : null),
  readRepo: () => ({ owner: 'o', repo: 'r', defaultBranch: 'main' }),
  ghGet: () => {
    state.reads++;
    return Promise.resolve({ data: [{ number: 41, title: 'Version packages', head: { ref: 'changeset-release/main' }, user: { login: 'github-actions[bot]' }, labels: [], body }] });
  },
}));
vi.mock('./pr-status', () => ({ owners: () => ({ design: state.holders, tech: [] }), shippers: () => undefined }));
vi.mock('./teams', () => ({ loadTeams: () => Promise.resolve() }));

const flush = () => new Promise((r) => setTimeout(r, 20));
const page = () => {
  document.body.innerHTML = `<section id="next-release" hidden><p id="bb-release-title"></p><ul id="bb-release-lines" hidden></ul><a id="bb-release-cta" href="#"></a></section>`;
};

describe('the next release on Being built', () => {
  beforeEach(() => {
    vi.resetModules();
    state.reads = 0;
    document.documentElement.removeAttribute('data-next-release');
  });

  it('shows to whoever may publish, with Review and publish on the release, its words as text', async () => {
    state.viewer = 'ana';
    page();
    const { initNextRelease } = await import('./next-release');
    initNextRelease();
    await flush();
    const card = document.getElementById('next-release')!;
    expect(card.hidden).toBe(false);
    expect(document.documentElement.hasAttribute('data-next-release')).toBe(true);
    expect(document.getElementById('bb-release-title')!.textContent).toMatch(/^Library update ready: /);
    expect(document.getElementById('bb-release-cta')!.getAttribute('href')).toBe('/studio/changes/?pr=41');
    expect(card.querySelector('img')).toBeNull();
    expect(state.reads).toBe(1);
  });

  it('stays hidden, and reads nothing, for anyone else', async () => {
    state.viewer = 'lea';
    page();
    const { initNextRelease } = await import('./next-release');
    initNextRelease();
    await flush();
    expect(document.getElementById('next-release')!.hidden).toBe(true);
    expect(document.documentElement.hasAttribute('data-next-release')).toBe(false);
    expect(state.reads).toBe(0);
  });
});
