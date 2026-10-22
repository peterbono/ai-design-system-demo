// What waits on the viewer besides branches, for Branches > Waiting on me (components/ds/studio/BranchesList, handed
// over with scripts/reviews.ts setWaitingExtras): the usage guidance drafts on main and the suggestions.
//   - In the lead's seat on the demo (a visitor without an account, lib/demo.ts): every open suggestion waits, read
//     from the same list the demo home reads (scripts/demo-home.ts readDemoActivity; on a team page its activity
//     snapshot answers it, no API request), with who asked for each.
//   - Signed in: the suggestions that wait on the viewer (scripts/suggestions.ts loadSuggestionQueue).
//   - Signed out anywhere else: nothing waits on anyone.
import { productsOf } from '@bridge-ds/core';
import { currentViewer } from './github-session';
import { siteConfig } from './repo-context';
import { isDemoRepo } from '../lib/demo';
import { askerOf } from '../lib/demo-home';
import { guidanceNeed } from '../lib/home-model';
import { guidanceExtra, suggestionExtra, type WaitingExtra } from '../lib/review-categories';
import { shortTitle, suggestionNeed } from '../lib/suggestions-view';

export async function readWaitingExtras(x: { owner: string; repo: string; guidance: { name: string; href: string; since: string | null }[] }): Promise<WaitingExtra[]> {
  const now = Date.now();
  const viewer = currentViewer();
  const seat = !viewer && isDemoRepo(`${x.owner}/${x.repo}`) && Boolean((siteConfig() as { demo?: { viewer?: string } }).demo?.viewer);
  if (!seat && !viewer) return [];
  const products = productsOf(siteConfig() as { products?: never });
  const guidance = x.guidance.map((g) => guidanceExtra(guidanceNeed(g, now)));
  if (seat) {
    const { readDemoActivity } = await import('./demo-home');
    const { suggestions } = await readDemoActivity({ owner: x.owner, repo: x.repo }).catch(() => ({ suggestions: [] }));
    const asked = suggestions
      .filter((s) => !s.pull_request)
      .map((s) => {
        const need = suggestionNeed({ number: s.number, title: shortTitle(s.title), createdAt: s.created_at }, askerOf({ user: s.user, body: s.body ?? null, labels: null }), now);
        return suggestionExtra({ ...need, number: s.number }, s.number, (s.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)), products);
      });
    return [...asked, ...guidance];
  }
  const [{ loadSuggestionQueue }, { personOf }] = await Promise.all([import('./suggestions'), import('./home-data')]);
  const asked = await loadSuggestionQueue(personOf).catch(() => []);
  return [...asked.map((a) => suggestionExtra(a.need, a.need.number!, a.labels, products)), ...guidance];
}
