// Studio > Visual impact: one row per open pull request, saying whether the visual impact workflow published a
// manifest for its head commit and, if so, how much changed. The before/after slider lives in the review detail.
import { visualBase, type VisualManifest } from '../lib/visual-impact';
import { esc, ghGet, GitHubError, RateLimitError, readRepo, relativeTime } from './github-session';
import { manifestPublished } from './reviews/visual-impact';
import { currentBranch } from './shell';

interface Pull {
  number: number;
  title: string;
  draft?: boolean;
  updated_at: string;
  user: { login: string };
  head: { ref: string; sha: string };
}

/** At most this many pull requests are checked: each check costs a few GitHub requests. */
const MAX = 10;

type Row = { p: Pull; state: 'published'; m: VisualManifest } | { p: Pull; state: 'none' } | { p: Pull; state: 'error'; message: string };

async function check(owner: string, repo: string, p: Pull): Promise<Row> {
  try {
    if (!(await manifestPublished(owner, repo, p.number, p.head.sha))) return { p, state: 'none' };
    const r = await ghGet<string>(`${visualBase(owner, repo, p.number, p.head.sha)}/manifest.json`, { raw: true });
    return { p, state: 'published', m: JSON.parse(r.data) as VisualManifest };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return { p, state: 'none' };
    return { p, state: 'error', message: err instanceof RateLimitError ? 'GitHub rate limit reached' : (err as Error).message };
  }
}

function rowHtml(r: Row, workflow: string): string {
  const p = r.p;
  const head = `<span class="st-vi-main"><a class="st-vi-title" href="/studio/reviews/?pr=${p.number}">${esc(p.title)}</a>
    <span class="st-review-meta"><span class="mono">#${p.number}</span><span class="mono">${esc(p.head.ref)}</span><span>at <span class="mono">${esc(p.head.sha.slice(0, 7))}</span></span><span>updated ${esc(relativeTime(p.updated_at))}</span></span></span>`;
  if (r.state === 'published') {
    const s = r.m.summary;
    const changed = s.changed + s.added + s.removed;
    return `<li class="st-vi-row">${head}
      <span class="st-vi-stats">
        <span class="pill ${changed ? 'is-warn' : 'is-pass'}">${changed ? `${changed} changed` : 'No visual change'}</span>
        <span class="small muted num">${s.shots} screenshot${s.shots === 1 ? '' : 's'}${changed ? `, up to ${s.maxPercent.toFixed(2)}% of pixels` : ''}${s.errors ? `, ${s.errors} failed` : ''}</span>
      </span>
      <a class="btn btn-secondary btn-sm" href="/studio/reviews/?pr=${p.number}">Before and after</a></li>`;
  }
  if (r.state === 'none')
    return `<li class="st-vi-row">${head}<span class="st-vi-stats"><span class="pill">No visual run for this commit</span><span class="small muted">Runs on pull requests that touch tokens or components.</span></span><a class="btn btn-secondary btn-sm" href="${esc(workflow)}" target="_blank" rel="noopener">Workflow runs</a></li>`;
  return `<li class="st-vi-row">${head}<span class="st-vi-stats"><span class="pill is-fail">Not checked</span><span class="small muted">${esc(r.message)}</span></span><a class="btn btn-secondary btn-sm" href="/studio/reviews/?pr=${p.number}">Open review</a></li>`;
}

export async function initVisualList() {
  const list = document.getElementById('vi-list');
  const scope = document.getElementById('vi-scope');
  const notice = document.getElementById('vi-notice');
  if (!list) return;
  const { owner, repo } = readRepo();
  const workflow = `https://github.com/${owner}/${repo}/actions/workflows/visual-impact.yml`;
  const branch = currentBranch();
  try {
    const f = await ghGet<Pull[]>(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
    let pulls = [...f.data].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (branch) {
      pulls = pulls.filter((p) => p.head.ref === branch);
      if (scope) {
        const all = new URL(location.href);
        all.searchParams.delete('branch');
        scope.innerHTML = `Showing <span class="mono">${esc(branch)}</span> only. <a href="${esc(all.pathname + all.search)}">Show every pull request</a>`;
        scope.hidden = false;
      }
    }
    if (f.stale && notice) {
      notice.textContent = "Showing this browser's last copy: GitHub's anonymous rate limit is reached. Connect GitHub for fresh data.";
      notice.hidden = false;
    }
    if (!pulls.length) {
      list.innerHTML = `<li class="st-review-empty"><span>${branch ? `No open pull request on ${esc(branch)}.` : 'No open pull requests, so nothing to compare.'}</span></li>`;
      return;
    }
    const checked = pulls.slice(0, MAX);
    const rows = await Promise.all(checked.map((p) => check(owner, repo, p)));
    list.innerHTML =
      rows.map((r) => rowHtml(r, workflow)).join('') +
      (pulls.length > MAX ? `<li class="st-review-more"><span>${pulls.length - MAX} older pull requests not checked. Open them from <a href="/studio/reviews/">Reviews</a>.</span></li>` : '');
  } catch (err) {
    list.innerHTML = `<li class="st-review-empty is-fail"><span>${
      err instanceof RateLimitError
        ? 'GitHub limits anonymous reads to 60 an hour and this browser has used them. Connect GitHub, or try again later.'
        : `Could not reach GitHub: ${esc((err as Error).message)}`
    }</span></li>`;
  } finally {
    list.removeAttribute('aria-busy');
  }
}
