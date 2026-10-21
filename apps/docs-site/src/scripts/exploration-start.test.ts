// @vitest-environment jsdom
// Starting an exploration follows the repository's "changes" mode: an exploration is a branch, so a repository in
// suggest mode gets none from Bridge, and nothing reaches GitHub.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPLORATION_SUGGEST_LINE } from '../lib/gh-wording';
import { SuggestOnlyError } from './changes-mode';
import { explorationsConfig, startLinkedExploration } from './exploration-start';

const page = (json: string) => {
  document.body.innerHTML = `<script type="application/json" id="bridge-repo">${json}</script>`;
};

describe('startLinkedExploration', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('refuses in suggest mode, before any GitHub call, with the sentence to show', async () => {
    page('{"owner":"acme","repo":"ds","defaultBranch":"main","changes":"suggest"}');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const start = startLinkedExploration(explorationsConfig(), { name: 'Pill buttons', purpose: 'Rounder?' });
    await expect(start).rejects.toBeInstanceOf(SuggestOnlyError);
    await expect(start).rejects.toThrow(EXPLORATION_SUGGEST_LINE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts against the repository on the page in direct mode', async () => {
    page('{"owner":"acme","repo":"ds","defaultBranch":"trunk","changes":"direct"}');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })));
    expect(explorationsConfig()).toMatchObject({ owner: 'acme', repo: 'ds', defaultBranch: 'trunk' });
    // Past the mode check: whatever GitHub (or the missing sign-in) says next, it is not the suggest-mode refusal.
    const err = await startLinkedExploration(explorationsConfig(), { name: 'Pill buttons', purpose: 'Rounder?' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SuggestOnlyError);
  });
});
