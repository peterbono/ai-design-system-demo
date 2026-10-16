// Reviews: open pull requests of the configured repo, read client-side from the GitHub REST API, with a
// designer-friendly token diff and governance-aware actions. Without a token every action deep-links to GitHub.
import { classifyRisk } from '@bridge/core';
import { mergeGate, parseChangeset, parseTier, summarizeApprovals, summarizeCi, type CheckRunLike, type ReviewLike, type StatusLike, type Tier } from '../lib/review-rules';
import { currentViewer, esc, getToken, ghGet, ghWrite, initGitHubConnect, RateLimitError, readRepo, relativeTime, type Fetched } from './github-session';
import { analyzeTokenFiles, isTokenFile, type TokenReview } from './reviews/token-review';

interface User {
  login: string;
  avatar_url: string;
  html_url?: string;
}
interface Pull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  user: User;
  body: string | null;
  labels: { name: string; color?: string }[];
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged?: boolean;
  mergeable?: boolean | null;
  comments?: number;
  review_comments?: number;
}
interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
  raw_url?: string;
}
interface Comment {
  user: User | null;
  body: string;
  created_at: string;
  html_url: string;
}
interface Review extends ReviewLike {
  body: string | null;
  html_url: string;
  user: User | null;
}

const repo = readRepo();
const R = `/repos/${repo.owner}/${repo.repo}`;
const OWNERS = (() => {
  try {
    const raw = JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { owners?: { design: string[]; tech: string[] } };
    return raw.owners ?? { design: [], tech: [] };
  } catch {
    return { design: [], tech: [] };
  }
})();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const listEl = () => $('rv-list');
const detailEl = () => $('rv-detail');
const notice = () => $('rv-notice');

function staleNotice(f: Fetched<unknown>) {
  if (!f.stale) return;
  const when = f.cachedAt ? relativeTime(f.cachedAt) : 'earlier';
  const reset = f.resetAt ? ` GitHub lets this browser read again ${relativeTime(f.resetAt.toISOString()).replace('in ', 'in ')}, around ${f.resetAt.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}.` : '';
  showNotice('warn', `GitHub's limit for anonymous reads (60 an hour) is reached, so this shows data saved in this browser ${when}.${reset} Connect a token to lift the limit to 5,000.`);
}

function showNotice(tone: 'warn' | 'fail' | 'info', text: string) {
  const n = notice();
  n.hidden = false;
  n.className = `rv-notice is-${tone}`;
  n.textContent = text;
}

function tierPill(t: Tier | null) {
  if (!t) return '<span class="pill">Tier not set</span>';
  return `<span class="pill rv-tier is-t${t}">Tier ${t}</span>`;
}

function ciPill(state: string, loading = false) {
  if (loading) return '<span class="pill rv-ci is-loading">CI</span>';
  const map: Record<string, [string, string]> = {
    pass: ['is-pass', 'CI passing'],
    fail: ['is-fail', 'CI failing'],
    pending: ['is-warn', 'CI running'],
    none: ['', 'No CI yet'],
  };
  const [cls, label] = map[state] ?? ['', state];
  return `<span class="pill rv-ci ${cls}">${label}</span>`;
}

function avatar(u: User | null, size = 24) {
  if (!u) return '';
  return `<img class="rv-avatar" src="${esc(u.avatar_url)}&s=${size * 2}" alt="" width="${size}" height="${size}" loading="lazy" />`;
}

// ---------------------------------------------------------------------------------------------------------------
// List

async function loadList() {
  const el = listEl();
  el.setAttribute('aria-busy', 'true');
  try {
    const f = await ghGet<Pull[]>(`${R}/pulls?state=open&per_page=50&sort=updated&direction=desc`);
    staleNotice(f);
    const pulls = f.data;
    $('rv-count').textContent = String(pulls.length);
    try {
      localStorage.setItem('bridge.reviews.open', JSON.stringify({ n: pulls.length, at: new Date().toISOString() }));
    } catch {
      /* ignore */
    }
    if (!pulls.length) {
      el.innerHTML = `<div class="rv-empty"><h2>No open pull requests</h2><p>When someone proposes a change from Figma, the token explorer or an agent, it shows up here for review.</p></div>`;
      return;
    }
    el.innerHTML = pulls
      .map((p) => {
        const tier = parseTier(p.labels, p.body);
        const tokens = /^tokens\//.test(p.head.ref) || p.labels.some((l) => /token/i.test(l.name));
        return `<li class="rv-row" data-pr="${p.number}">
          <a class="rv-row-link" href="?pr=${p.number}" data-open-pr="${p.number}">
            <span class="rv-row-main">
              <span class="rv-row-title">${esc(p.title)}</span>
              <span class="rv-row-meta">
                <span class="mono">#${p.number}</span>
                ${avatar(p.user, 18)}<span>${esc(p.user.login)}</span>
                <span class="rv-sep" aria-hidden="true"></span>
                <span class="mono rv-branch">${esc(p.head.ref)}</span>
                <span class="rv-sep" aria-hidden="true"></span>
                <span>updated ${relativeTime(p.updated_at)}</span>
              </span>
            </span>
            <span class="rv-row-pills">
              ${p.draft ? '<span class="pill">Draft</span>' : ''}
              ${tokens ? '<span class="pill is-accent">Tokens</span>' : ''}
              ${tierPill(tier)}
              <span data-ci-slot="${p.number}">${ciPill('', true)}</span>
            </span>
          </a>
        </li>`;
      })
      .join('');
    // CI per row, in the background; a rate limit here only leaves the pill neutral.
    for (const p of pulls) {
      ciFor(p.head.sha)
        .then((ci) => {
          const slot = el.querySelector(`[data-ci-slot="${p.number}"]`);
          if (slot) slot.innerHTML = ciPill(ci.state);
        })
        .catch(() => {
          const slot = el.querySelector(`[data-ci-slot="${p.number}"]`);
          if (slot) slot.innerHTML = ciPill('none');
        });
    }
  } catch (err) {
    el.innerHTML = '';
    if (err instanceof RateLimitError) {
      showNotice('warn', 'GitHub limits anonymous reads to 60 an hour and this browser has used them, with nothing saved yet. Connect a token, or try again later.');
    } else {
      showNotice('fail', `Could not load pull requests: ${(err as Error).message}`);
    }
  } finally {
    el.removeAttribute('aria-busy');
  }
}

async function ciFor(sha: string) {
  const [runs, statuses] = await Promise.all([
    ghGet<{ check_runs: CheckRunLike[] }>(`${R}/commits/${sha}/check-runs?per_page=100`),
    ghGet<{ statuses: StatusLike[] }>(`${R}/commits/${sha}/status`).catch(() => ({ data: { statuses: [] as StatusLike[] }, stale: false })),
  ]);
  return summarizeCi(runs.data.check_runs, statuses.data.statuses);
}

// ---------------------------------------------------------------------------------------------------------------
// Detail

let current: { pull: Pull; tier: Tier | null } | null = null;

async function openPr(n: number, push = true) {
  if (push) history.pushState({ pr: n }, '', `?pr=${n}`);
  $('rv-list-view').hidden = true;
  const d = detailEl();
  d.hidden = false;
  d.innerHTML = `<p class="rv-loading">Loading pull request #${n}</p>`;
  window.scrollTo({ top: 0 });
  try {
    const pf = await ghGet<Pull>(`${R}/pulls/${n}`);
    staleNotice(pf);
    const pull = pf.data;
    const [files, reviews, comments, ci] = await Promise.all([
      ghGet<PrFile[]>(`${R}/pulls/${n}/files?per_page=100`).then((f) => f.data),
      ghGet<Review[]>(`${R}/pulls/${n}/reviews?per_page=100`).then((f) => f.data).catch(() => [] as Review[]),
      ghGet<Comment[]>(`${R}/issues/${n}/comments?per_page=100`).then((f) => f.data).catch(() => [] as Comment[]),
      ciFor(pull.head.sha).catch(() => summarizeCi([])),
    ]);
    // Highest tier wins: the label or checkbox the author set, or what the shared classifier (the one the
    // plugin, the editor and the MCP server use) computes from the changed files.
    const labelled = parseTier(pull.labels, pull.body);
    const computed = classifyRisk({ files: files.map((f) => ({ path: f.filename, status: f.status })) }).tier;
    const tier = Math.max(labelled ?? 0, computed) as Tier;
    current = { pull, tier };
    const approvals = summarizeApprovals(reviews, OWNERS, pull.user.login);
    const gate = mergeGate({ tier, ci, approvals, draft: pull.draft, mergeable: pull.mergeable, state: pull.state });
    const tokenFiles = files.filter((f) => isTokenFile(f.filename));
    const changesets = files.filter((f) => /^\.changeset\/(?!README).+\.md$/.test(f.filename) && f.status !== 'removed');

    d.innerHTML = renderDetail(pull, tier, files, reviews, comments, ci, approvals, gate, tokenFiles.length, changesets.length);
    wireActions(pull, gate);

    if (tokenFiles.length) {
      const slot = $('rv-tokens');
      analyzeTokenFiles({ owner: repo.owner, repo: repo.repo, baseSha: pull.base.sha, headSha: pull.head.sha, files: tokenFiles })
        .then((review) => (slot.innerHTML = renderTokenReview(review)))
        .catch((err) => (slot.innerHTML = `<p class="rv-error">Could not compute the token diff: ${esc((err as Error).message)}</p>`));
    }
    if (changesets.length) {
      const slot = $('rv-changeset');
      Promise.all(
        changesets.map((f) =>
          ghGet<string>(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${pull.head.sha}/${f.filename}`, { raw: true }).then((r) => ({ f, text: r.data })),
        ),
      )
        .then((all) =>
          (slot.innerHTML = all
            .map(({ f, text }) => {
              const c = parseChangeset(text);
              return `<div class="rv-cs"><p class="mono small muted">${esc(f.filename)}</p><p>${c.bumps
                .map((b) => `<span class="pill ${b.bump === 'major' ? 'is-fail' : b.bump === 'minor' ? 'is-warn' : 'is-pass'}">${esc(b.pkg)} ${b.bump}</span>`)
                .join(' ')}</p><p>${esc(c.summary)}</p></div>`;
            })
            .join('')),
        )
        .catch(() => (slot.innerHTML = '<p class="muted">Could not read the changeset.</p>'));
    }
  } catch (err) {
    d.innerHTML = `<p><a href="./" data-back>Back to reviews</a></p>`;
    if (err instanceof RateLimitError) showNotice('warn', 'GitHub limits anonymous reads to 60 an hour. Connect a token, or open this pull request on GitHub.');
    else showNotice('fail', `Could not load pull request #${n}: ${(err as Error).message}`);
  }
}

function renderDetail(
  pull: Pull,
  tier: Tier | null,
  files: PrFile[],
  reviews: Review[],
  comments: Comment[],
  ci: ReturnType<typeof summarizeCi>,
  approvals: ReturnType<typeof summarizeApprovals>,
  gate: ReturnType<typeof mergeGate>,
  tokenCount: number,
  changesetCount: number,
) {
  const owners = OWNERS.design.length || OWNERS.tech.length;
  const check = (ok: boolean, label: string) => `<li class="${ok ? 'is-pass' : 'is-pending'}"><span class="rv-check" aria-hidden="true"></span>${label}</li>`;
  const conversation = [
    ...reviews
      .filter((r) => r.state !== 'PENDING')
      .map((r) => ({ at: r.submitted_at ?? '', user: r.user, kind: r.state, body: r.body ?? '', url: r.html_url })),
    ...comments.map((c) => ({ at: c.created_at, user: c.user, kind: 'COMMENT', body: c.body, url: c.html_url })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const kindLabel: Record<string, [string, string]> = {
    APPROVED: ['is-pass', 'approved'],
    CHANGES_REQUESTED: ['is-fail', 'requested changes'],
    COMMENTED: ['', 'reviewed'],
    DISMISSED: ['', 'review dismissed'],
    COMMENT: ['', 'commented'],
  };
  return `
  <nav class="rv-crumbs"><a href="./" data-back>Reviews</a><span aria-hidden="true">/</span><span class="mono">#${pull.number}</span></nav>
  <header class="rv-head">
    <h1 class="rv-title">${esc(pull.title)} <span class="rv-num mono">#${pull.number}</span></h1>
    <div class="rv-head-meta">
      ${pull.draft ? '<span class="pill">Draft</span>' : `<span class="pill is-pass">Open</span>`}
      ${tierPill(tier)}
      ${ciPill(ci.state)}
      <span class="rv-by">${avatar(pull.user, 20)}<strong>${esc(pull.user.login)}</strong> wants to merge <span class="mono rv-branch">${esc(pull.head.ref)}</span> into <span class="mono rv-branch">${esc(pull.base.ref)}</span></span>
      <a class="rv-gh-link" href="${esc(pull.html_url)}" target="_blank" rel="noopener">Open on GitHub</a>
    </div>
  </header>
  <div class="rv-layout">
    <div class="rv-main">
      ${
        tokenCount
          ? `<section class="rv-card" aria-labelledby="rv-tok-h"><header class="rv-card-head"><h2 id="rv-tok-h">Token changes</h2><span class="muted small">${tokenCount} token file${tokenCount > 1 ? 's' : ''}</span></header><div id="rv-tokens"><p class="rv-loading">Resolving tokens at both commits</p></div></section>`
          : `<section class="rv-card"><header class="rv-card-head"><h2>Files</h2><span class="muted small">${files.length} changed</span></header><ul class="rv-files">${files
              .slice(0, 40)
              .map((f) => `<li><span class="mono">${esc(f.filename)}</span><span class="rv-delta"><span class="is-add">+${f.additions}</span> <span class="is-del">-${f.deletions}</span></span></li>`)
              .join('')}</ul></section>`
      }
      <section class="rv-card" aria-labelledby="rv-ci-h">
        <header class="rv-card-head"><h2 id="rv-ci-h">Checks</h2>${ciPill(ci.state)}</header>
        ${
          ci.total
            ? `<ul class="rv-checks">${[
                ...ci.failed.map((x) => ({ ...x, s: 'fail' })),
                ...ci.pending.map((x) => ({ ...x, s: 'pending' })),
              ]
                .map((x) => `<li class="is-${x.s}"><span class="rv-check" aria-hidden="true"></span>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>` : esc(x.name)}<span class="muted small">${x.s === 'fail' ? 'failing' : 'running'}</span></li>`)
                .join('')}<li class="is-pass"><span class="rv-check" aria-hidden="true"></span>${ci.passed} check${ci.passed === 1 ? '' : 's'} passing</li></ul>`
            : '<p class="muted">No checks reported for the head commit yet.</p>'
        }
      </section>
      <section class="rv-card" aria-labelledby="rv-cs-h">
        <header class="rv-card-head"><h2 id="rv-cs-h">Changeset</h2></header>
        <div id="rv-changeset">${changesetCount ? '<p class="rv-loading">Reading changeset</p>' : '<p class="rv-warnline">No changeset in this pull request. CI asks for one when a package changes.</p>'}</div>
      </section>
      <section class="rv-card" aria-labelledby="rv-conv-h">
        <header class="rv-card-head"><h2 id="rv-conv-h">Conversation</h2><span class="muted small">${conversation.length}</span></header>
        ${
          conversation.length
            ? `<ol class="rv-conv">${conversation
                .map((c) => {
                  const [cls, label] = kindLabel[c.kind] ?? ['', c.kind.toLowerCase()];
                  return `<li><div class="rv-conv-head">${avatar(c.user, 20)}<strong>${esc(c.user?.login ?? 'someone')}</strong> <span class="rv-kind ${cls}">${label}</span> <a class="muted small" href="${esc(c.url)}" target="_blank" rel="noopener">${c.at ? relativeTime(c.at) : ''}</a></div>${c.body ? `<div class="rv-conv-body">${esc(c.body).replace(/\n/g, '<br>')}</div>` : ''}</li>`;
                })
                .join('')}</ol>`
            : '<p class="muted">No reviews or comments yet.</p>'
        }
      </section>
    </div>
    <aside class="rv-side" aria-label="Review actions">
      <section class="rv-card rv-gate">
        <h2>Ready to merge?</h2>
        <ul class="rv-gate-list">
          ${check(ci.state === 'pass', ci.state === 'pass' ? 'CI passing' : ci.state === 'fail' ? 'CI failing' : ci.state === 'pending' ? 'CI running' : 'No CI result yet')}
          ${
            (tier ?? 3) === 3
              ? check(approvals.design, `Design approval${owners ? '' : ' (first approver)'}`) + check(approvals.tech, `Tech approval${owners ? '' : ' (second approver)'}`)
              : check(approvals.approvers.length > 0, 'One approval')
          }
          ${check(!pull.draft, pull.draft ? 'Marked ready for review (still a draft)' : 'Marked ready for review')}
        </ul>
        ${approvals.approvers.length ? `<p class="small muted">Approved by @${approvals.approvers.map(esc).join(', @')}</p>` : ''}
        ${gate.allowed ? '' : `<ul class="rv-reasons">${gate.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`}
      </section>
      <section class="rv-card rv-actions" id="rv-actions">
        <h2>Your review</h2>
        <div data-needs-token>
          <label class="rv-label" for="rv-body">Comment</label>
          <textarea id="rv-body" rows="4" placeholder="Say what to change and why. Required for Request changes."></textarea>
          <div class="rv-btns">
            <button type="button" class="btn btn-primary btn-sm" data-act="APPROVE">Approve</button>
            <button type="button" class="btn btn-secondary btn-sm" data-act="REQUEST_CHANGES">Request changes</button>
            <button type="button" class="btn btn-secondary btn-sm" data-act="COMMENT">Comment</button>
          </div>
          <div class="rv-btns rv-btns-end">
            <button type="button" class="btn btn-secondary btn-sm rv-danger" data-act="CLOSE">Close pull request</button>
            <button type="button" class="btn btn-primary btn-sm" data-act="MERGE" ${gate.allowed ? '' : 'disabled aria-describedby="rv-merge-why"'}>Merge</button>
          </div>
          ${gate.allowed ? '' : `<p class="small muted" id="rv-merge-why">Merge unlocks when the checks above pass.</p>`}
        </div>
        <div data-no-token>
          <p class="small">Connect a GitHub token to review from here. Until then, every action opens GitHub.</p>
          <div class="rv-btns">
            <button type="button" class="btn btn-primary btn-sm" data-gh-open>Connect GitHub</button>
            <a class="btn btn-secondary btn-sm" href="${esc(pull.html_url)}/files#submit-review" target="_blank" rel="noopener">Review on GitHub</a>
            <a class="btn btn-secondary btn-sm" href="${esc(pull.html_url)}#issuecomment-new" target="_blank" rel="noopener">Comment on GitHub</a>
          </div>
        </div>
        <p class="rv-act-status" id="rv-act-status" role="status" aria-live="polite"></p>
      </section>
    </aside>
  </div>`;
}

function syncAuthViews() {
  const has = Boolean(getToken() && currentViewer());
  document.querySelectorAll<HTMLElement>('[data-needs-token]').forEach((el) => (el.hidden = !has));
  document.querySelectorAll<HTMLElement>('[data-no-token]').forEach((el) => (el.hidden = has));
}

function wireActions(pull: Pull, gate: ReturnType<typeof mergeGate>) {
  syncAuthViews();
  const status = $('rv-act-status');
  const body = $<HTMLTextAreaElement>('rv-body');
  document.querySelectorAll<HTMLButtonElement>('#rv-actions [data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const act = b.dataset.act!;
      const text = body.value.trim();
      if (act === 'REQUEST_CHANGES' && !text) {
        status.textContent = 'Add a comment that says what to change.';
        body.focus();
        return;
      }
      if (act === 'COMMENT' && !text) {
        status.textContent = 'Write a comment first.';
        body.focus();
        return;
      }
      if (act === 'MERGE' && !gate.allowed) return;
      if (act === 'CLOSE' && !window.confirm(`Close pull request #${pull.number} without merging?`)) return;
      if (act === 'MERGE' && !window.confirm(`Merge pull request #${pull.number} into ${pull.base.ref}?`)) return;
      b.disabled = true;
      status.textContent = 'Sending to GitHub';
      try {
        if (act === 'APPROVE' || act === 'REQUEST_CHANGES' || act === 'COMMENT') {
          await ghWrite('POST', `${R}/pulls/${pull.number}/reviews`, { event: act, body: text || undefined, commit_id: pull.head.sha });
        } else if (act === 'MERGE') {
          await ghWrite('PUT', `${R}/pulls/${pull.number}/merge`, { merge_method: 'squash', sha: pull.head.sha });
        } else if (act === 'CLOSE') {
          await ghWrite('PATCH', `${R}/pulls/${pull.number}`, { state: 'closed' });
        }
        status.textContent = { APPROVE: 'Approved.', REQUEST_CHANGES: 'Changes requested.', COMMENT: 'Comment posted.', MERGE: 'Merged.', CLOSE: 'Closed.' }[act] ?? 'Done.';
        body.value = '';
        await openPr(pull.number, false);
      } catch (err) {
        status.textContent = `GitHub refused: ${(err as Error).message}`;
        b.disabled = false;
      }
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Token diff rendering

const swatch = (hex?: string | null) => (hex ? `<span class="rv-sw" style="background-color:${esc(hex)}"></span>` : '');

function valueCell(v: { css?: string | null; hex?: string | null; alias?: string | null } | null) {
  if (!v) return '<span class="muted">none</span>';
  return `<span class="rv-val">${swatch(v.hex)}<span class="mono">${esc(v.alias ? `{${v.alias}}` : (v.css ?? ''))}</span>${v.alias && v.css ? `<span class="muted mono small">${esc(v.css)}</span>` : ''}</span>`;
}

export function renderTokenReview(review: TokenReview): string {
  if (!review.changes.length) return '<p class="muted">The token files changed, but no token value did (formatting or descriptions only).</p>';
  const rows = review.changes
    .map(
      (c) => `<tr>
        <th scope="row"><span class="mono">${esc(c.path)}</span><span class="rv-kind-tag is-${c.kind}">${c.kind}</span>${c.context ? `<span class="muted small">${esc(c.context)}</span>` : ''}</th>
        <td>${valueCell(c.before)}</td>
        <td><span class="rv-arrow" aria-label="becomes">-></span></td>
        <td>${valueCell(c.after)}</td>
      </tr>`,
    )
    .join('');
  const contrast = review.contrast.length
    ? `<h3 class="rv-sub">Contrast, before -> after</h3>
       <p class="small muted">Checked pairs whose ratio moves because either color resolves through a changed token, in each brand and theme. Failing pairs that run through a changed token stay listed.</p>
       <div class="table-wrap"><table class="rv-table rv-contrast"><thead><tr><th scope="col">Pair</th><th scope="col">Where</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Min</th></tr></thead><tbody>${review.contrast
         .map(
           (p) => `<tr class="${p.after < p.min ? 'is-fail' : p.after < p.before ? 'is-down' : ''}">
          <th scope="row"><span class="rv-pair"><span class="rv-aa" style="background-color:${esc(p.bgHexAfter)};color:${esc(p.fgHexAfter)}">Aa</span><span class="mono small">${esc(p.fg)}<br><span class="muted">on</span> ${esc(p.bg)}</span></span></th>
          <td class="small">${esc(p.where)}</td>
          <td class="num">${p.before.toFixed(2)}:1</td>
          <td class="num"><strong>${p.after.toFixed(2)}:1</strong> ${p.after < p.min ? '<span class="pill is-fail">Fails</span>' : p.after >= p.before ? '' : '<span class="pill is-warn">Lower</span>'}</td>
          <td class="num">${p.min}:1</td></tr>`,
         )
         .join('')}</tbody></table></div>`
    : '<p class="small muted">No checked contrast pair depends on these tokens.</p>';
  return `<div class="table-wrap"><table class="rv-table"><thead><tr><th scope="col">Token</th><th scope="col">Before</th><th scope="col"><span class="sr-only">Change</span></th><th scope="col">After</th></tr></thead><tbody>${rows}</tbody></table></div>${contrast}${
    review.failing ? `<p class="rv-error">${review.failing} contrast check${review.failing > 1 ? 's' : ''} would fail after this change. The token build will block it.</p>` : ''
  }`;
}

// ---------------------------------------------------------------------------------------------------------------

export function initReviews() {
  initGitHubConnect(() => {
    syncAuthViews();
  });
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-open-pr]');
    if (a && !(e as MouseEvent).metaKey && !(e as MouseEvent).ctrlKey) {
      e.preventDefault();
      openPr(Number(a.dataset.openPr));
      return;
    }
    const back = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-back]');
    if (back) {
      e.preventDefault();
      history.pushState({}, '', location.pathname);
      showList();
    }
  });
  window.addEventListener('popstate', () => route());
  route();
}

function showList() {
  detailEl().hidden = true;
  $('rv-list-view').hidden = false;
  current = null;
  loadList();
}

function route() {
  const n = Number(new URLSearchParams(location.search).get('pr'));
  if (n) openPr(n, false);
  else showList();
}

export const _current = () => current;
