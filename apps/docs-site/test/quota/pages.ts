// The reads one load of each Studio page sends to Bridge's read path for a signed-in member, in phases (a phase waits
// for the one before: the open list before the status batch). Collected from the browser code paths (2026-11-02,
// after #763/#764); file references are under apps/docs-site/src:
//   every Studio page   scripts/repo-context.ts 174-175 (access, default branch head), the snapshot when the model of
//                       that head is not in IndexedDB (repo-cache.ts), the nav badge (shell.ts 668-695 ->
//                       needs-you.ts 112): the open list and a changes= batch, and per change that closes an issue the
//                       suggestion reads of scripts/pr-status.ts pullStatus (approvedSuggestionOf)
//   Home                scripts/home-data.ts 254-566 (a second changes= batch, products, design tasks, suggestions,
//                       closed list, explorations, waiting rows' timelines, thumbnails, users=)
//   Changes             scripts/reviews.ts 659-768, team-branches.ts 90-188 (compare per change, closed list)
//   a change (?pr=n)    scripts/reviews.ts 816-986
//   Being built         scripts/building-data.ts 136-201 (lists kept 5 min in the tab)
//   a product           scripts/product-page.ts 76-160
//   Library             the team load, llms.txt, audits, the Figma-ahead lists (no badge). These may go to GitHub with
//                       the viewer's own token instead (github-session.ts 735-751); counted here as Bridge reads, the
//                       pessimistic case for the installation.
// The tab keeps proxied answers 20 s, by-sha answers 10 min (scripts/contribute-session.ts 317-427), and some lists
// longer in sessionStorage (`keep`); the simulation skips a read the same person's tab still keeps.

import { shaOf, type FakeWorld } from './fake-github';

export type PageName = 'home' | 'changes' | 'change' | 'building' | 'product' | 'library';

export interface ClientRead {
  /** A GitHub path under /repos/<repo> (gh=). */
  gh?: string;
  /** The repository of `gh` when it is not the team's (a product repository). */
  repo?: string;
  changes?: { number: number; sha: string }[];
  blobs?: string[];
  users?: string[];
  headers?: Record<string, string>;
  /** How long the person's tab keeps this answer (ms): the default is 20 s, 10 min for a read by sha. */
  keep?: number;
}

export interface PageCtx {
  role: 'lead' | 'designer';
  team: string;
  /** Which of the person's loads this is (0: first, the IndexedDB model is cold). */
  load: number;
}

type Page = (w: FakeWorld, o: PageCtx) => ClientRead[][];

const MIN = 60 * 1000;
const OPEN = '/pulls?state=open&per_page=100';
const ALL = '/pulls?state=all&per_page=50&sort=updated&direction=desc';

/** Changes per status batch (api/_lib/team-read.ts MAX_CHANGES). */
const batches = (w: FakeWorld): ClientRead[] => {
  const refs = w.changes.map((c) => ({ number: c.number, sha: c.sha }));
  const out: ClientRead[] = [];
  for (let i = 0; i < refs.length; i += 20) out.push({ changes: refs.slice(i, i + 20) });
  return out;
};

/** Every Studio page: access, the default branch head, the snapshot when the model is cold, the nav badge. */
function shell(w: FakeWorld, o: PageCtx, badge = true): ClientRead[][] {
  const first: ClientRead[] = [{ gh: '', keep: 10 * MIN }, { gh: '/git/ref/heads/main' }];
  if (badge) first.push({ gh: OPEN });
  // The model of this head is in IndexedDB after the first load (repo-cache.ts): no snapshot read until main moves.
  const snapshot: ClientRead[] = o.load === 0 ? [{ gh: '/git/matching-refs/heads/bridge-data', keep: Infinity }, { gh: '/contents/snapshot.json?ref=bridge-data', keep: Infinity }] : [];
  const second: ClientRead[] = [...snapshot, ...(badge ? batches(w) : [])];
  // A change whose body closes a suggestion issue (one in five here): the issue, its comments, the recent pull list.
  const third: ClientRead[] = badge ? w.changes.filter((c) => c.number % 5 === 0).flatMap((c) => [{ gh: `/issues/${c.number + 200}` }, { gh: `/issues/${c.number + 200}/comments?per_page=100` }, { gh: ALL }]) : [];
  return [first, second, third];
}

const people = (w: FakeWorld): ClientRead => ({ users: ['dana', 'mia', 'lead-1', ...Array.from({ length: 5 }, (_, i) => `designer-${i}`)].slice(0, Math.min(8, 3 + w.changes.length)) });
const product = (w: FakeWorld, path: string, keep?: number): ClientRead[] => w.products.map((repo) => ({ gh: path, repo, ...(keep ? { keep } : {}) }));
const tasks = (n: number): ClientRead[] => Array.from({ length: n }, (_, i) => [{ gh: `/issues/${400 + i}` }, { gh: `/issues/${400 + i}/timeline?per_page=100` }]).flat();
const suggestions = (n: number): ClientRead[] => [
  { gh: '/issues?state=open&per_page=50&sort=created&direction=desc&labels=bridge-suggestion', keep: 2 * MIN },
  { gh: ALL, keep: 2 * MIN },
  ...Array.from({ length: n }, (_, i) => [{ gh: `/issues/${500 + i}`, keep: 2 * MIN }, { gh: `/issues/${500 + i}/comments?per_page=100`, keep: 2 * MIN }, { gh: '/git/ref/heads/main', keep: 2 * MIN }, { gh: `/compare/${shaOf(`base-${i}`)}...main`, keep: 2 * MIN }]).flat(),
];
/** A row's thumbnail: a token change reads its tree and token files at base and head (by sha), a component change the visual branch. */
function thumbnail(w: FakeWorld, i: number): ClientRead[] {
  const c = w.changes[i % w.changes.length]!;
  if (i % 2) return [{ gh: '/git/matching-refs/heads/bridge-visual' }, ...[0, 1, 2].map((k) => ({ gh: `/git/trees/${shaOf(`visual-${k}`)}` })), { gh: '/contents/manifest.json?ref=bridge-visual' }];
  return [{ gh: `/git/trees/${w.main}?recursive=1` }, ...[0, 1, 2].flatMap((k) => [{ gh: `/contents/packages/tokens/src/semantic/light/${k}.json?ref=${w.main}` }, { gh: `/contents/packages/tokens/src/semantic/light/${k}.json?ref=${c.sha}` }])];
}

const home: Page = (w, o) => {
  const [a, b, c] = shell(w, o);
  // Rows waiting on this person: a lead reviews half the open changes, a designer has two of their own.
  const waiting = o.role === 'lead' ? Math.ceil(w.changes.length / 2) : Math.min(2, w.changes.length);
  return [
    [...a!, ...product(w, OPEN), { gh: '/pulls?state=closed&sort=updated&direction=desc&per_page=30' }, ...suggestions(2).slice(0, 2)],
    // home-data.ts asks the status batch again (no dedupe with the badge's).
    [...b!, ...batches(w), ...tasks(4), ...suggestions(2).slice(2), ...w.changes.slice(0, 2).map((x) => ({ gh: `/pulls/${x.number}/files?per_page=100` }))],
    [...c!, ...w.changes.slice(0, waiting).map((x) => ({ gh: `/issues/${x.number}/timeline?per_page=100` })), people(w), ...Array.from({ length: Math.min(4, waiting) }, (_, i) => thumbnail(w, i)).flat()],
  ];
};

const changes: Page = (w, o) => {
  const [a, b, c] = shell(w, o);
  return [
    [...a!, ...product(w, OPEN), { gh: '/pulls?state=closed&sort=updated&direction=desc&per_page=50' }, ...suggestions(2).slice(0, 2)],
    [...b!, ...batches(w), ...w.changes.map((x) => ({ gh: `/compare/main...${x.sha}` })), ...w.changes.slice(0, 2).map((x) => ({ gh: `/pulls/${x.number}/files?per_page=100` })), ...suggestions(2).slice(2)],
    [...c!, people(w)],
  ];
};

const change: Page = (w, o) => {
  const [a, b, c] = shell(w, o);
  const x = w.changes[o.load % w.changes.length]!;
  // The five status paths come from the badge's batch kept in the tab (20 s); the rest are the change's own reads.
  return [
    [...a!, { gh: `/pulls/${x.number}` }],
    [...b!, { gh: `/issues/${x.number}/comments?per_page=100` }, { gh: `/pulls/${x.number}/comments?per_page=100` }, { gh: `/compare/main...${x.sha}` }, { gh: '/contents/.github/workflows' }, { gh: '/rules/branches/main' }],
    [...c!, ...thumbnail(w, 0), people(w)],
  ];
};

const building: Page = (w, o) => {
  const [a, b, c] = shell(w, o);
  return [
    [...a!, { gh: '/issues?labels=component-change&state=all&per_page=100&sort=created&direction=desc', keep: 5 * MIN }, { gh: '/issues?labels=bridge-build&state=all&per_page=100&sort=created&direction=desc', keep: 5 * MIN }, { gh: '/pulls?state=all&per_page=100&sort=updated&direction=desc', keep: 5 * MIN }, ...product(w, OPEN, 5 * MIN)],
    [...b!, ...tasks(2), { gh: `/pulls/${w.changes[0]?.number ?? 1}` }, { gh: `/pulls/${w.changes[1]?.number ?? 2}` }],
    [...c!, { ...people(w), keep: 7 * 24 * 60 * MIN }],
  ];
};

const productPage: Page = (w, o) => {
  const [a, b, c] = shell(w, o);
  const one = { ...w, products: w.products.slice(0, 1) };
  return [
    [...a!, ...product(one, OPEN), ...product(one, '/pulls?state=closed&sort=updated&direction=desc&per_page=30')],
    [...b!, ...tasks(2)],
    [...c!, people(w)],
  ];
};

const library: Page = (w, o) => {
  const [a, b] = shell(w, o, false);
  return [
    [...a!, { gh: '/contents/llms.txt?ref=bridge-data' }, { gh: '/issues?labels=component-change&state=all&per_page=100&sort=created&direction=desc' }, { gh: '/issues?labels=bridge-build&state=all&per_page=100&sort=created&direction=desc' }, { gh: ALL }],
    [...b!, ...[0, 1, 2].map((i) => ({ gh: `/contents/audits/a${i}.json?ref=bridge-data` }))],
  ];
};

export const PAGES: Record<PageName, Page> = { home, changes, change, building, product: productPage, library };
