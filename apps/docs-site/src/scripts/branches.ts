// Branches: open pull requests (and other branches) of the configured repo with what each offers for testing in a
// product: deploy previews, a snapshot install command, the tokens.css override URL, CI and visual impact.
// Reads the public GitHub REST API without a token (60 requests an hour); a connected token lifts the limit.
import { branchChecks, branchEntry, orphanBranches, pullEntry, type BranchEntry, type BranchesConfig, type PullLike } from '../lib/branches';
import type { CheckRunLike, CiState } from '../lib/review-rules';
import { esc, ghGet, initGitHubConnect, RateLimitError, relativeTime, type Fetched } from './github-session';

/** Check runs are one request per row: cap them so an anonymous visitor keeps most of the hourly budget. */
const MAX_CHECKED = 12;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function readConfig(): BranchesConfig {
  try {
    return JSON.parse($('bridge-branches').textContent || '{}') as BranchesConfig;
  } catch {
    return { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main', apps: {}, packages: [] };
  }
}

function notice(tone: 'warn' | 'fail', text: string) {
  const n = $('br-notice');
  n.hidden = false;
  n.className = `rv-notice is-${tone}`;
  n.textContent = text;
}

function staleNotice(f: Fetched<unknown>) {
  if (!f.stale) return;
  notice('warn', `GitHub's limit for anonymous reads (60 an hour) is reached, so this shows data saved in this browser ${f.cachedAt ? relativeTime(f.cachedAt) : 'earlier'}. Connect a token to lift the limit.`);
}

function statePill(kind: 'CI' | 'Visual impact', state: CiState | 'loading', url?: string | null) {
  if (state === 'loading') return `<span class="pill is-loading">${kind}</span>`;
  const label: Record<CiState, string> =
    kind === 'CI'
      ? { pass: 'CI passing', fail: 'CI failing', pending: 'CI running', none: 'No CI yet' }
      : { pass: 'Visual impact reviewed', fail: 'Visual changes to review', pending: 'Visual impact running', none: 'No visual impact check' };
  const cls: Record<CiState, string> = { pass: 'is-pass', fail: 'is-fail', pending: 'is-warn', none: '' };
  const pill = `<span class="pill ${cls[state]}">${label[state]}</span>`;
  return url ? `<a class="br-pill-link" href="${esc(url)}">${pill}</a>` : pill;
}

let copyId = 0;
function copyBlock(label: string, text: string) {
  const id = `br-copy-${++copyId}`;
  return `<div class="br-cmd">
    <span class="br-cmd-label">${esc(label)}</span>
    <code class="br-cmd-text" id="${id}">${esc(text)}</code>
    <button type="button" class="btn btn-secondary btn-sm br-cmd-copy" data-copy-from="${id}" data-copy aria-label="Copy: ${esc(label)}"><span data-copy-label>Copy</span></button>
  </div>`;
}

function row(e: BranchEntry, cfg: BranchesConfig): string {
  const previews = e.previews.length
    ? `<ul class="br-previews" aria-label="Previews">${e.previews.map((p) => `<li><a class="btn btn-secondary btn-sm" href="${esc(p.url)}">${esc(p.label)}</a></li>`).join('')}</ul>`
    : `<p class="br-hint">${e.fromFork ? 'Pull request from a fork: no preview deploys or snapshots.' : 'No preview deploys configured.'}</p>`;
  const meta = [
    e.pr ? `<a class="mono" href="${esc(e.url)}">#${e.pr}</a>` : `<a href="${esc(e.url)}">View on GitHub</a>`,
    e.author ? `<span>${esc(e.author)}</span>` : '',
    `<span class="mono rv-branch">${esc(e.branch)}</span>`,
    `<span class="mono">${esc(e.sha.slice(0, 7))}</span>`,
    e.updatedAt ? `<span>updated ${relativeTime(e.updatedAt)}</span>` : '',
  ].filter(Boolean);
  const blocks = [
    e.install ? copyBlock('Install this snapshot', e.install) : '',
    e.tokensCss ? copyBlock('Tokens only, on staging', `?bridge-tokens=${e.tokensCss}`) : '',
  ].join('');
  const key = e.pr ? `pr-${e.pr}` : `b-${e.branch}`;
  return `<li class="br-row">
    <div class="br-row-head">
      <div class="rv-row-main">
        <span class="rv-row-title">${e.pr ? `<a href="${esc(e.url)}">${esc(e.title)}</a>` : esc(e.title)}</span>
        <span class="rv-row-meta">${meta.join('<span class="rv-sep" aria-hidden="true"></span>')}</span>
      </div>
      <span class="rv-row-pills">
        ${e.draft ? '<span class="pill">Draft</span>' : ''}
        <span data-ci-slot="${esc(key)}">${statePill('CI', 'loading')}</span>
        <span data-visual-slot="${esc(key)}">${statePill('Visual impact', 'loading')}</span>
      </span>
    </div>
    ${previews}
    ${blocks}
    ${e.install && cfg.packages.length ? `<p class="br-hint">Snapshots exist once the Preview packages workflow ran on this commit.</p>` : ''}
  </li>`;
}

async function fillChecks(list: HTMLElement, entries: BranchEntry[], cfg: BranchesConfig) {
  for (const [i, e] of entries.entries()) {
    const key = e.pr ? `pr-${e.pr}` : `b-${e.branch}`;
    const ci = list.querySelector(`[data-ci-slot="${CSS.escape(key)}"]`);
    const visual = list.querySelector(`[data-visual-slot="${CSS.escape(key)}"]`);
    if (i >= MAX_CHECKED) {
      if (ci) ci.innerHTML = `<a class="br-pill-link" href="${esc(e.url)}"><span class="pill">Checks on GitHub</span></a>`;
      if (visual) visual.innerHTML = '';
      continue;
    }
    ghGet<{ check_runs: CheckRunLike[] }>(`/repos/${cfg.owner}/${cfg.repo}/commits/${e.sha}/check-runs?per_page=100`)
      .then((f) => {
        const c = branchChecks(f.data.check_runs);
        if (ci) ci.innerHTML = statePill('CI', c.ci, e.pr ? `${e.url}/checks` : null);
        if (visual) visual.innerHTML = statePill('Visual impact', c.visual.state, c.visual.url);
      })
      .catch(() => {
        if (ci) ci.innerHTML = statePill('CI', 'none');
        if (visual) visual.innerHTML = statePill('Visual impact', 'none');
      });
  }
}

async function load(cfg: BranchesConfig) {
  const list = $('br-list');
  list.setAttribute('aria-busy', 'true');
  try {
    const f = await ghGet<PullLike[]>(`/repos/${cfg.owner}/${cfg.repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`);
    staleNotice(f);
    const pulls = f.data;
    $('br-count').textContent = String(pulls.length);
    const entries = pulls.map((p) => pullEntry(p, cfg));
    list.innerHTML = entries.length
      ? entries.map((e) => row(e, cfg)).join('')
      : `<li class="rv-empty"><h2>No open pull requests</h2><p>Open a pull request from a design system branch and its previews and snapshot show up here.</p></li>`;
    void fillChecks(list, entries, cfg);

    // Other branches: one more request, skipped quietly when it fails.
    ghGet<{ name: string; commit: { sha: string } }[]>(`/repos/${cfg.owner}/${cfg.repo}/branches?per_page=100`)
      .then((b) => {
        const rest = orphanBranches(b.data, pulls, cfg.defaultBranch).map((x) => branchEntry(x, cfg));
        if (!rest.length || !rest.some((e) => e.previews.length)) return;
        $('br-other').hidden = false;
        const other = $('br-other-list');
        other.innerHTML = rest.map((e) => row(e, cfg)).join('');
        other.querySelectorAll('[data-ci-slot], [data-visual-slot]').forEach((el) => (el.innerHTML = ''));
      })
      .catch(() => {});
  } catch (err) {
    list.innerHTML = '';
    if (err instanceof RateLimitError) {
      notice('warn', 'GitHub limits anonymous reads to 60 an hour and this browser has used them, with nothing saved yet. Connect a token, or try again later.');
    } else {
      notice('fail', `Could not load pull requests: ${(err as Error).message}. Check the repository in bridge.config.json.`);
    }
  } finally {
    list.removeAttribute('aria-busy');
  }
}

export function initBranches() {
  const cfg = readConfig();
  // initGitHubConnect reports the stored token once at start (the first load already used it); reload on later
  // connects and disconnects only.
  let first = true;
  initGitHubConnect(() => {
    if (first) first = false;
    else void load(cfg);
  });
  void load(cfg);
}
