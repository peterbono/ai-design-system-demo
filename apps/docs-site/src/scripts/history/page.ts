// Library > Changelog > Token and guidance changes, by release (components/TokenChanges.astro, #token-changes): one
// timeline of merged token and usage guidance changes grouped by release, and an entry detail in place (?entry=) with
// the designer diff. Read only: undoing is Studio's (Tokens, "Restore this value"). Moved from Changes > History
// (lib/history-moved): the next release is on Being built (scripts/next-release.ts), what shipped is the Shipped tab
// of Changes. Real history only in production; in development the demo switch at the bottom swaps in the fixture
// report and a banner. Filters wait behind the Filter button.
import type { HistoryEntry, HistoryFilter, HistoryReport } from '@bridge-ds/core';
import { closingIssueNumbers, parseSuggestionOverrideComment, publishedWithoutReview, tier1PublishOf, type SuggestionOverrideRecord } from '@bridge-ds/core';
import { authorsOf, countsLabel, shortDate, viewTimeline } from '../../lib/history-view';
import { renderTokenReview } from '../reviews';
import { esc, ghGet, hasWorkingToken, signedInWithGitHub, initGitHubConnect, readRepo } from '../github-session';
import { mdTitleHtml } from '../../lib/markdown';
import { approvalNeedLabel } from '../../lib/review-queue';
import { historySummary } from '../../lib/release-view';
import { activeReport, DEMO_EVENT, demoOn, loadHistory, setDemo, teamEntryReview, type Loaded } from './state';
import { isHosted, studioHref, studioHrefAt, teamHref } from '../../lib/team-path';
import { libraryFromPath, ownLibrary, sameTeam } from '../../lib/library-shells';
import { TOKEN_CHANGES_ID } from '../../lib/history-moved';
import { parseOverrideComment, type OverrideRecord } from '../../lib/review-rules';
import { overrideLine, suggestionOverrideLine } from '../../lib/history-view';
import { onSelectPick, selectValue, setSelect } from '../../lib/select-bridge';
import { jiraKeyOf, VOCAB, withoutJiraKey } from '../../lib/vocabulary';
import { agentMade } from '../../lib/work-nature';
import { displayName, paintPeople, personHtml } from '../people';
import { attrUrl } from '../../lib/html';
import { GUIDANCE_TAG, groupCountLine, isGuidanceEntry } from '../../lib/history-guidance';

/** Claude made the change when its description carries an AI agent marker (lib/work-nature). */
const agentOf = (e: HistoryEntry) => agentMade({ body: e.pr?.body ?? null });

const AUTHOR = 'hs-author';
const TIER = 'hs-tier';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
/** The Token filter field. The DS Input's Field gives the input its own id, so the page marks it with an attribute. */
const tokenField = () => document.querySelector<HTMLInputElement>('[data-hs-token]')!;
let L: Loaded | null = null;

/** A team's Library (/library/<owner>/<repo>/changelog/), not this site's own: read only, the team's repository. */
const teamLibrary = () => {
  const t = libraryFromPath(location.pathname);
  return t && !sameTeam(t, ownLibrary()) ? t : null;
};
/** The list of this page, on the token changes. */
const listHref = () => `${location.pathname}#${TOKEN_CHANGES_ID}`;
/** The repository the history is read from: the one the report names, else this page's. */
const ghRepo = (): { owner: string; repo: string } => {
  const r = L?.config.repo;
  return r ? { owner: r.owner, repo: r.name } : (teamLibrary() ?? readRepo());
};
/** A Studio address of the library this page documents: the team's Studio on a team's Library. */
const studioOf = (route: string) => {
  const t = teamLibrary();
  return t ? studioHrefAt(teamHref(t.owner, t.repo, null), route) : studioHref(route);
};

const repoUrl = () => {
  const x = ghRepo();
  return `https://github.com/${x.owner}/${x.repo}`;
};

function current(): { report: HistoryReport | null; demo: boolean } {
  return L ? activeReport(L.data) : { report: null, demo: false };
}

function filter(): HistoryFilter {
  const token = tokenField().value.trim();
  const author = selectValue(AUTHOR);
  const tier = Number(selectValue(TIER));
  return { ...(token ? { token } : {}), ...(author ? { author } : {}), ...(tier ? { tier: tier as 1 | 2 | 3 } : {}) };
}

const entryHref = (e: HistoryEntry) => `${location.pathname}?entry=${encodeURIComponent(e.id)}#${TOKEN_CHANGES_ID}`;
const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
/** A human summary (the changeset line the author wrote, else the cleaned title), never a raw commit subject. */
const title = (e: HistoryEntry) => withoutJiraKey(historySummary(e));
/** The Jira key the branch title started with, shown apart in mono. */
const jiraOf = (e: HistoryEntry) => jiraKeyOf(e.title) ?? jiraKeyOf(historySummary(e));

/** A row: summary and #, what approval it needed in plain words (or Demo), the date. Counts live in the detail. */
function row(e: HistoryEntry, demo: boolean): string {
  const key = jiraOf(e);
  const tag = `<span class="cg-need">${e.bulk ? 'Import' : `${demo ? 'Demo, ' : ''}${isGuidanceEntry(e) ? GUIDANCE_TAG : approvalNeedLabel(e.tier)}`}</span>`;
  return `<li class="cg-row"><a class="cg-row-link" href="${entryHref(e)}" data-hs-open="${esc(e.id)}">
    <span class="cg-row-title">${personHtml(e.author, { agent: agentOf(e), withName: false })}${key ? `<span class="mono cg-jira">${esc(key)}</span> ` : ''}<span class="cg-row-name" title="${esc(title(e))}">${esc(title(e))}</span></span>
    ${tag}
    <time class="cg-date" datetime="${esc(e.date)}">${esc(dayMonth(e.date))}</time></a></li>`;
}

/** Imports and restructures fold into one line per release, opened on demand. */
function importsRow(items: HistoryEntry[], demo: boolean): string {
  if (!items.length) return '';
  const edits = items.reduce((n, e) => n + e.counts.total, 0);
  return `<li class="cg-row cg-imports"><details><summary class="cg-imports-sum"><span class="cg-row-title">${items.length} ${items.length === 1 ? 'import' : 'imports'}, ${edits.toLocaleString('en-US')} token edits</span><span class="cg-sec-chev" aria-hidden="true"></span></summary>
    <ul class="cg-list">${items.map((e) => row(e, demo)).join('')}</ul></details></li>`;
}

function paintList() {
  const { report, demo } = current();
  const tl = $('hs-timeline');
  tl.setAttribute('aria-busy', 'false');
  $('hs-banner').hidden = !demo;
  document.getElementById('hs-demo')?.setAttribute('aria-checked', String(demo));
  const entries = report?.entries ?? [];
  // Filters follow the report on screen.
  const authors = authorsOf(entries);
  const keep = selectValue(AUTHOR);
  setSelect(AUTHOR, { options: [{ value: '', label: 'Anyone' }, ...authors.map((a) => ({ value: a, label: displayName(a) }))], value: authors.includes(keep) ? keep : '' });
  const paths = [...new Set(entries.filter((e) => !e.bulk).flatMap((e) => e.changes.map((c) => c.path)))].sort();
  $('hs-paths').innerHTML = paths.map((p) => `<option value="${esc(p)}"></option>`).join('');

  // No report: why (signed out on a team page, or history that could not be read), with the one way forward.
  const note = L?.data.realNote ?? null;
  // Nothing to filter without a report: the Filter button waits for one. Signing in is offered once, by the page (the
  // guest banner and the side bar), not again here.
  $('hs-filter-toggle').hidden = !report;
  if (!report && note && !demo) {
    $('hs-filters').hidden = true;
    tl.innerHTML = `<div class="cg-empty"><p class="cg-muted">${esc(note)}</p></div>`;
    $('hs-none').hidden = true;
    return;
  }
  if (!report || !entries.length) {
    tl.innerHTML = `<p class="cg-muted">Nothing added to the library yet. Token and usage guidance changes land here once they are in the library.</p>`;
    $('hs-none').hidden = true;
    return;
  }
  const groups = viewTimeline(report, filter());
  // A capped history (a team's, read from GitHub) says so under the list, with the way to the rest.
  const cap = !demo && report.truncated && note ? `<p class="cg-muted hs-cap">${esc(note)} <a href="${attrUrl(`${repoUrl()}/commits`)}" target="_blank" rel="noopener">See every change on GitHub<span class="sr-only"> (opens in a new tab)</span></a></p>` : '';
  $('hs-none').hidden = groups.length > 0;
  tl.innerHTML = groups
    .map((g) => {
      const name = g.version === 'Unreleased' ? 'Next release' : `Version ${g.version}`;
      // Token and usage guidance changes: the "Next release" card above counts every change, this group these ones.
      const facts = [groupCountLine(g.items), g.breaking ? 'breaking' : '', `${g.pending ? 'latest' : 'released'} ${shortDate(g.date)}`].filter(Boolean).join(', ');
      const reviewable = g.items.filter((e) => !e.bulk);
      const imports = g.items.filter((e) => e.bulk);
      return `<section class="cg-rel" aria-label="${esc(name)}"><h3 class="cg-rel-h">${esc(name)} <span class="cg-rel-meta">${esc(facts)}</span></h3>
        <ul class="fg-card cg-list">${reviewable.map((e) => row(e, demo)).join('')}${importsRow(imports, demo)}</ul></section>`;
    })
    .join('') + cap;
  void paintPeople(tl);
}

/** A team's entries carry no diff from the build: it is read from GitHub when the entry opens. */
const teamDiff = (e: HistoryEntry, demo: boolean) => !demo && (isHosted() || teamLibrary() !== null) && !e.bulk && Boolean(e.baseSha);

/** A usage guidance change: what it changed in words, and the way to its page; no token diff. */
function paintGuidanceDetail(e: HistoryEntry, ref: string) {
  const at = e.pr ? studioOf(`changes/?pr=${e.pr.number}`) : null;
  $('hs-detail').innerHTML = `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="${attrUrl(listHref())}" data-hs-back>Token changes</a><span aria-hidden="true">/</span><span>${esc(title(e))}</span></nav>
    <header class="fg-card cg-pr-open">
      <h3 class="cg-pr-title" tabindex="-1">${esc(withoutJiraKey(historySummary(e, { full: true })))}</h3>
      <p class="cg-pr-meta"><span class="cg-who">${personHtml(e.author, { agent: agentOf(e), size: 'sm' })}<span>, ${esc(shortDate(e.date))}</span></span><span>${esc([GUIDANCE_TAG, e.version && e.version !== 'Unreleased' ? e.version : 'next release'].join(', '))}</span>${ref}</p>
      <p class="cg-pr-state">Usage guidance changed. No token changed.</p>
      ${at ? `<p class="cg-pr-cta"><a class="btn btn-secondary" href="${attrUrl(at)}">See the change</a></p>` : ''}
    </header>`;
  void paintPeople($('hs-detail'));
}

/**
 * The developer view of an entry (the merged branch, else what landed on main): one quiet link on the author line, for
 * a GitHub account only. A designer signed in by email has no GitHub to open it with (designers never see GitHub).
 */
function githubRef(e: HistoryEntry): string {
  if (hasWorkingToken() && !signedInWithGitHub()) return '';
  return `<a class="cg-gh" href="${attrUrl(e.pr ? (e.pr.url ?? `${repoUrl()}/pull/${e.pr.number}`) : `${repoUrl()}/commit/${e.sha}`)}" target="_blank" rel="noopener">${VOCAB.openOnGitHub}<span class="sr-only"> (opens in a new tab)</span></a>`;
}

function paintDetail(e: HistoryEntry, demo: boolean) {
  if (!demo && isGuidanceEntry(e)) {
    return paintGuidanceDetail(e, githubRef(e));
  }
  const review = L!.data.reviews[`${demo ? 'demo' : 'real'}:${e.id}`];
  const diff = e.bulk
    ? `<p class="cg-muted">Imports are listed, not diffed. First ${Math.min(40, e.changes.length)} of ${e.changes.length} tokens:</p><ul class="hs-paths">${e.changes
        .slice(0, 40)
        .map((c) => `<li><span class="mono">${esc(c.path)}</span> <span class="cg-muted">${esc(c.kind)}</span></li>`)
        .join('')}</ul>`
    : review
      ? renderTokenReview(review)
      : teamDiff(e, demo)
        ? '<p class="cg-muted" role="status">Reading the token changes from GitHub</p>'
        : '<p class="cg-muted">No designer diff for this change.</p>';
  // The developer view of it (the merged branch, else what landed on main) is one quiet link on the author line.
  const ref = demo ? '<span>Fixture change</span>' : githubRef(e);
  const facts = [e.bulk ? 'Import' : approvalNeedLabel(e.tier), e.breaking ? 'breaking' : '', e.version && e.version !== 'Unreleased' ? e.version : 'next release'].filter(Boolean).join(', ');
  $('hs-detail').innerHTML = `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="${attrUrl(listHref())}" data-hs-back>Token changes</a><span aria-hidden="true">/</span><span>${esc(title(e))}</span></nav>
    <header class="fg-card cg-pr-open">
      <h3 class="cg-pr-title" tabindex="-1">${esc(withoutJiraKey(historySummary(e, { full: true })))}</h3>
      <p class="cg-pr-meta"><span class="cg-who">${personHtml(e.author, { agent: agentOf(e), size: 'sm' })}<span>, ${esc(shortDate(e.date))}</span></span><span>${esc(facts)}</span>${ref}</p>
      <p class="cg-pr-state">${e.why !== e.title && e.why.replace(/\.$/, '') !== withoutJiraKey(historySummary(e, { full: true })).replace(/\.$/, '') ? mdTitleHtml(e.why) : esc(countsLabel(e.counts))}</p>
      <p class="cg-pr-state hs-override" data-hs-override hidden></p>
    </header>
    <div class="cg-secs">
      <details class="cg-sec" open><summary class="cg-sec-head"><span class="cg-sec-title">Token changes</span><span class="cg-sec-meta">${esc(countsLabel(e.counts))}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary><div class="cg-sec-body">${diff}</div></details>
    </div>`;
  void paintPeople($('hs-detail'));
  if (!demo && e.pr) void paintOverride(e, e.pr.number);
  if (!review && teamDiff(e, demo) && L) {
    const loaded = L;
    teamEntryReview(e, loaded)
      .then((r) => {
        if (!r) return;
        loaded.data.reviews[`real:${e.id}`] = r;
        // Still on this entry: paint it again with its diff.
        if (new URLSearchParams(location.search).get('entry') === e.id) paintDetail(e, demo);
      })
      .catch(() => {
        const body = $('hs-detail').querySelector('.cg-sec-body');
        if (body && new URLSearchParams(location.search).get('entry') === e.id) body.innerHTML = '<p class="cg-muted">GitHub did not send the token files of this change. Open it on GitHub to see them.</p>';
      });
  }
}

const overrides = new Map<number, Promise<OverrideRecord | null>>();

/**
 * A branch merged with the owner override: who merged it, why, and which approvals it went without, read back from
 * the reason posted on it (core parseOverrideComment). One read per branch, kept for the page; nothing when it was
 * an ordinary merge or GitHub cannot be read.
 */
async function paintOverride(e: HistoryEntry, n: number) {
  let read = overrides.get(n);
  if (!read) {
    const r = ghRepo();
    read = ghGet<{ body?: string | null }[]>(`/repos/${r.owner}/${r.repo}/issues/${n}/comments?per_page=100`)
      .then((f) => f.data.map((c) => parseOverrideComment(c.body)).filter((x): x is OverrideRecord => x !== null && x.merged).pop() ?? null)
      .catch(() => null);
    overrides.set(n, read);
  }
  const ov = await read;
  const el = $('hs-detail').querySelector<HTMLElement>('[data-hs-override]');
  if (!el || new URLSearchParams(location.search).get('entry') !== e.id) return;
  if (!ov) return paintSuggestionOverride(e, n, el);
  el.innerHTML = overrideLine(ov, esc, (login) => personHtml(login, { size: 'sm' }));
  el.hidden = false;
  void paintPeople(el);
}

const suggestionOverrides = new Map<number, Promise<SuggestionOverrideRecord | null>>();

/**
 * A change that applied a suggestion its owner approved with the owner override (docs/GOVERNANCE.md): the record is
 * on the suggestion it closes ("Closes #n"), read back with core parseSuggestionOverrideComment. Else the Tier 1
 * publish line, else nothing.
 */
async function paintSuggestionOverride(e: HistoryEntry, n: number, el: HTMLElement) {
  let read = suggestionOverrides.get(n);
  if (!read) {
    const r = ghRepo();
    read = ghGet<{ body?: string | null }>(`/repos/${r.owner}/${r.repo}/pulls/${n}`)
      .then(async (pr) => {
        for (const issue of closingIssueNumbers(pr.data.body)) {
          const c = await ghGet<{ body?: string | null }[]>(`/repos/${r.owner}/${r.repo}/issues/${issue}/comments?per_page=100`);
          const ov = c.data.map((x) => parseSuggestionOverrideComment(x.body)).filter((x): x is SuggestionOverrideRecord => x !== null).pop();
          if (ov) return ov;
        }
        return null;
      })
      .catch(() => null);
    suggestionOverrides.set(n, read);
  }
  const ov = await read;
  if (new URLSearchParams(location.search).get('entry') !== e.id) return;
  if (!ov) return paintPublished(e, n, el);
  el.innerHTML = suggestionOverrideLine(ov, esc, (login) => personHtml(login, { size: 'sm' }));
  el.hidden = false;
  void paintPeople(el);
}

const published = new Map<number, Promise<string | null>>();

/**
 * A Tier 1 change a lead published without review (docs/GOVERNANCE.md "Tier 1 publish by leads"): "Published by Ana
 * without review (Tier 1).", read back from Bridge's review on it (core tier1PublishOf). Nothing for any other merge.
 */
async function paintPublished(e: HistoryEntry, n: number, el: HTMLElement) {
  let read = published.get(n);
  if (!read) {
    const r = ghRepo();
    read = ghGet<{ state: string; body?: string | null }[]>(`/repos/${r.owner}/${r.repo}/pulls/${n}/reviews?per_page=100`)
      .then((f) => tier1PublishOf(f.data))
      .catch(() => null);
    published.set(n, read);
  }
  const by = await read;
  if (!by || new URLSearchParams(location.search).get('entry') !== e.id) return;
  el.textContent = publishedWithoutReview(by);
  el.hidden = false;
}

/** Paints the token changes from the URL (?entry=). */
export function routeHistory() {
  const id = new URLSearchParams(location.search).get('entry');
  const { report, demo } = current();
  const e = id && report ? report.entries.find((x) => x.id === id) : undefined;
  const toggle = $('hs-filter-toggle');
  if (e && report) {
    paintDetail(e, demo);
    $('hs-list-view').hidden = true;
    toggle.hidden = true;
    $('hs-filters').hidden = true;
    $('hs-detail').hidden = false;
    ($('hs-detail').querySelector('h3') as HTMLElement | null)?.focus();
  } else {
    $('hs-detail').hidden = true;
    $('hs-list-view').hidden = false;
    toggle.hidden = false;
    $('hs-filters').hidden = toggle.getAttribute('aria-expanded') !== 'true';
    paintList();
  }
}

let started = false;

/** Wires the token changes once, then loads the history data. */
export function initHistory() {
  if (started) {
    routeHistory();
    return;
  }
  started = true;
  // The GitHub link of an entry depends on who is connected (a GitHub account, not an email sign-in).
  initGitHubConnect(() => L && routeHistory());
  window.addEventListener('popstate', () => L && routeHistory());
  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const open = t.closest<HTMLAnchorElement>('[data-hs-open]');
    if (open && !(ev as MouseEvent).metaKey && !(ev as MouseEvent).ctrlKey) {
      ev.preventDefault();
      history.pushState({}, '', `${location.pathname}?entry=${encodeURIComponent(open.dataset.hsOpen!)}#${TOKEN_CHANGES_ID}`);
      routeHistory();
      return;
    }
    if (t.closest('[data-hs-back]')) {
      ev.preventDefault();
      history.pushState({}, '', listHref());
      routeHistory();
      document.getElementById(TOKEN_CHANGES_ID)?.scrollIntoView();
      return;
    }
    if (t.closest('[data-hs-clear]')) {
      ($('hs-filters') as HTMLFormElement).reset();
      paintList();
    }
  });
  const toggle = $('hs-filter-toggle');
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(on));
    $('hs-filters').hidden = !on;
    if (on) tokenField().focus();
  });
  document.getElementById('hs-demo')?.addEventListener('click', () => setDemo(!demoOn()));
  document.addEventListener(DEMO_EVENT, () => {
    history.replaceState({}, '', listHref());
    routeHistory();
  });
  let timer = 0;
  $('hs-filters').addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(paintList, 100);
  });
  // The Author and Kind of change menus are DS Select islands (components/ds/BridgedSelect): a pick repaints, and
  // Clear filters puts them back on their first option.
  onSelectPick(AUTHOR, () => paintList());
  onSelectPick(TIER, () => paintList());
  $('hs-filters').addEventListener('reset', () => {
    setSelect(AUTHOR, { value: '' });
    setSelect(TIER, { value: '' });
    setTimeout(paintList, 0);
  });
  // Deep link from a token drawer: ?token=color.text.muted opens the filters, prefilled.
  const token = new URLSearchParams(location.search).get('token');
  const tokenInput = document.querySelector<HTMLInputElement>('[data-hs-token]');
  if (token && tokenInput) {
    tokenInput.value = token;
    toggle.setAttribute('aria-expanded', 'true');
  }
  loadHistory()
    .then((l) => {
      L = l;
      routeHistory();
    })
    .catch((err) => {
      $('hs-timeline').innerHTML = `<p class="rv-notice is-fail">${esc((err as Error).message)}</p>`;
    });
}
