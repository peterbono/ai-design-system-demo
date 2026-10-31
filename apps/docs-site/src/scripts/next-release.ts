// Being built > the next release (components/NextRelease.astro): the release pull request in plain words, shown only
// to whoever may publish it (the merge right, governance.rights, else the owners), with "Review and publish" opening
// it in Changes, where publishing is merging it. Nobody else sees the card, and the release is read only once the
// viewer is known to hold that right (one GitHub read). Never writes.
import { currentViewer, esc, ghGet, hasWorkingToken, initGitHubConnect, readRepo } from './github-session';
import { releasePull, type QueuePull } from '../lib/review-queue';
import { parseReleaseBody, releaseCard } from '../lib/release-view';
import { owners, shippers } from './pr-status';
import { loadTeams } from './teams';
import { isHosted, studioHref } from '../lib/team-path';

interface ReleasePullLike extends QueuePull {
  number: number;
  body: string | null;
}

const $ = (id: string) => document.getElementById(id);

/** The viewer may publish: they hold the merge right (governance.rights), else they are an owner. */
function canPublish(): boolean {
  const viewer = hasWorkingToken() ? currentViewer()?.login : null;
  if (!viewer) return false;
  const o = owners();
  const holders = (shippers() ?? [...new Set([...o.design, ...o.tech])]).map((x) => x.replace(/^@/, '').toLowerCase());
  return holders.includes(viewer.toLowerCase());
}

let release: ReleasePullLike | null | undefined;
let reading: Promise<void> | null = null;

function paint() {
  const card = $('next-release');
  if (!card) return;
  const mine = canPublish();
  if (mine && release === undefined) {
    reading ??= (() => {
      const r = readRepo();
      return ghGet<ReleasePullLike[]>(`/repos/${r.owner}/${r.repo}/pulls?state=open&per_page=100`)
        .then((f) => {
          release = releasePull(f.data);
        })
        .catch(() => {
          // Rate limited with nothing saved: no card, the list stays as it is.
          release = null;
        })
        .then(paint);
    })();
  }
  const show = Boolean(mine && release);
  // The page's one Harbor zone while it shows: the list's sentence steps down (styles/building.css).
  document.documentElement.toggleAttribute('data-next-release', show);
  card.hidden = !show;
  if (!show || !release) return;
  const c = releaseCard(parseReleaseBody(release.body));
  $('bb-release-title')!.textContent = c.breaking ? `${c.title} Some of it needs action from product teams.` : c.title;
  const lines = $('bb-release-lines')!;
  lines.innerHTML = [...c.lines, ...(c.tools ? [c.tools] : [])].map((l) => `<li>${esc(l)}</li>`).join('');
  lines.hidden = !lines.innerHTML;
  const cta = $('bb-release-cta') as HTMLAnchorElement | null;
  if (cta) cta.href = studioHref(`changes/?pr=${release.number}`);
}

let started = false;

export function initNextRelease() {
  if (started) return;
  started = true;
  // Who may publish depends on who is connected, the GitHub teams in the owner lists, and on a team shell the team's
  // settings once read: repaint on each.
  initGitHubConnect(() => void loadTeams().then(paint, paint));
  if (isHosted()) void import('./team-data').then((m) => m.loadTeamData()).then(paint, () => undefined);
  paint();
}
