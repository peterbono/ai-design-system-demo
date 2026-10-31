import { describe, expect, it } from 'vitest';
import { assembleBuildRequests, composeBuildRequestIssue, figmaAheadLine, buildSummaryLine, DEFAULT_PRODUCTS, type ProductConfig } from '@bridge-ds/core';
import { sampleBuildData, SAMPLE_BUILDERS } from './building-sample';
import { ageLabel, buildDetail, explorationBuildRows, mergeRows, type RestPull, detailFromQuery, detailQuery, filterCounts, jiraLink, listedRows, pageSentence, rowThumb, propLine, rowLine, slimIssue, slimPull, statusTag, timelineSteps, toBuildIssue, toBuildPull, matchesBuildTab, withLifecycle } from './building-view';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const sample = () => {
  const { issues, pulls } = sampleBuildData(NOW);
  return assembleBuildRequests({ issues: issues.map(slimIssue).map(toBuildIssue), pulls: pulls.map(slimPull).map(toBuildPull), now: NOW, nameOf: (l) => SAMPLE_BUILDERS[l] ?? l });
};

describe('Being built', () => {
  it('shows the sample team every status, through the real rules', () => {
    const views = sample();
    expect(views.map((v) => `${v.component}:${v.status}${v.stale ? ':stale' : ''}`)).toEqual([
      'Tabs:requested:stale',
      'Button:requested',
      'Card:picked-up',
      'Select:in-progress',
      'Badge:in-review',
      'Avatar:shipped',
    ]);
    expect(views.find((v) => v.component === 'Card')!.sentence).toBe('Malik is on it.');
    expect(views.find((v) => v.component === 'Select')!.builders).toEqual(['theo']);
    expect(views.find((v) => v.component === 'Badge')!.jira).toBe('DS-128');
    // One build request per change: the spec branch from Figma that closes #41 is not a second row, and the sender
    // who opened it is not its builder.
    const button = views.filter((v) => v.component === 'Button');
    expect(button).toHaveLength(1);
    expect(button[0]).toMatchObject({ kind: 'issue', status: 'requested', builders: [] });
  });

  it('counts the filters and says the page in one sentence', () => {
    const views = sample();
    expect(filterCounts(views, NOW)).toEqual({ all: 6, waiting: 2, 'in-progress': 2, 'in-review': 1, 'shipped-this-week': 1 });
    expect(pageSentence(views)).toBe('2 being built, 1 in review, 2 waiting for a developer, 1 for more than a week.');
    expect(pageSentence([])).toBe('Nothing is being built yet.');
    expect(buildSummaryLine(views)).toBe('3 being built, 2 waiting to be picked up.');
  });

  it('gives each row one tag and one line, the stale one highlighted', () => {
    const views = sample();
    const stale = views[0]!;
    expect(statusTag(stale)).toEqual({ label: 'Requested 10 days ago', tone: 'warning' });
    expect(rowLine(stale, NOW)).toBe('Nobody has picked it up yet');
    expect(rowLine(views[1]!, NOW)).toBe('Sent 1 day ago');
    expect(rowLine(views[2]!, NOW)).toBe('Sent 4 days ago · Malik is on it');
    expect(rowLine(views[5]!, NOW)).toBe('Shipped 2 days ago');
    expect(statusTag(views[5]!)).toEqual({ label: 'Shipped', tone: 'success' });
    expect(ageLabel(new Date(NOW).toISOString(), NOW)).toBe('Today');
  });

  it('opens the detail in place by its address', () => {
    expect(detailQuery({ kind: 'issue', number: 41 })).toBe('?request=41');
    expect(detailQuery({ kind: 'pull', number: 52 })).toBe('?pull=52');
    expect(detailFromQuery('?request=41')).toEqual({ kind: 'issue', number: 41 });
    expect(detailFromQuery('?pull=7')).toEqual({ kind: 'pull', number: 7 });
    expect(detailFromQuery('?request=x')).toBeNull();
  });

  it('reads what was sent and the brief back from the issue', () => {
    const { issues } = sampleBuildData(NOW);
    const v = sample().find((x) => x.component === 'Button')!;
    const d = buildDetail(issues.find((i) => i.number === v.number)!.body, v)!;
    expect(d.summary).toContain('Hero sections');
    expect(d.props.map(propLine)).toEqual(['Change size (variant): sm, md, lg. Default md.']);
    expect(d.brief).toContain('Closes #41');
    expect(d.figmaUrl).toContain('figma.com');
    expect(buildDetail('no block', v)).toBeNull();
  });

  it('draws the status line with who and when', () => {
    const views = sample();
    const shipped = timelineSteps(views[5]!);
    expect(shipped.every((s) => s.reached)).toBe(true);
    expect(shipped.at(-1)).toMatchObject({ status: 'shipped', current: true });
    const picked = timelineSteps(views[2]!);
    expect(picked.map((s) => s.reached)).toEqual([true, true, false, false, false]);
    expect(picked[1]).toMatchObject({ who: 'malik-haddad', current: true });
  });

  it('links Jira only with a site set', () => {
    expect(jiraLink('DS-1', 'https://acme.atlassian.net/')).toBe('https://acme.atlassian.net/browse/DS-1');
    expect(jiraLink('DS-1', null)).toBeNull();
    expect(jiraLink('DS-1', 'javascript:alert(1)')).toBeNull();
  });

  it('gives the Library its line while a change is open', () => {
    const views = sample();
    expect(figmaAheadLine(views, 'Card', (l) => SAMPLE_BUILDERS[l] ?? l)?.sentence).toBe('Figma is ahead: 1 change being built (Malik).');
    expect(figmaAheadLine(views, 'Avatar')).toBeNull();
  });

  it('never writes an em dash', () => {
    const { issues } = sampleBuildData(NOW);
    for (const i of issues) expect(i.body).not.toMatch(/\u2014/);
  });

  describe('a request closed as not planned (issue #489, "Tag: test: rounder tag corners")', () => {
    const DAY = 86_400_000;
    const before = 'https://github.com/acme/ds/blob/bridge-visual/figma-references/tag/size-md.png?raw=true';
    const after = 'https://github.com/acme/ds/blob/bridge-requests/.bridge/requests/tag-1.png?raw=true';
    const tag = (closedDaysAgo: number) => {
      const r = composeBuildRequestIssue({ component: 'Tag', kind: 'visual', title: 'Test: rounder tag corners', summary: 'Tags would read softer.', figma: { nodeName: 'Tone=signal' }, images: { before: [before], after: [after] }, source: 'figma', requestedBy: 'dana' });
      return { number: 489, title: r.title, body: r.body, html_url: 'https://github.com/acme/ds/issues/489', state: 'closed', state_reason: 'not_planned', labels: r.labels, user: { login: 'dana' }, assignees: [], created_at: new Date(NOW - closedDaysAgo * DAY).toISOString(), closed_at: new Date(NOW - closedDaysAgo * DAY).toISOString() };
    };
    const viewsWith = (closedDaysAgo: number) => {
      const { issues, pulls } = sampleBuildData(NOW);
      return assembleBuildRequests({ issues: [...issues, tag(closedDaysAgo)].map(toBuildIssue), pulls: pulls.map(toBuildPull), now: NOW });
    };

    it('shows in All for a week after it was closed, then leaves the list, its count and its sentence', () => {
      const fresh = listedRows(viewsWith(6), NOW);
      expect(fresh.find((v) => v.number === 489)).toMatchObject({ status: 'not-planned', sentence: 'Developers closed it without building it.' });
      expect(filterCounts(fresh, NOW).all).toBe(7);
      const old = listedRows(viewsWith(8), NOW);
      expect(old.find((v) => v.number === 489)).toBeUndefined();
      expect(filterCounts(old, NOW)).toEqual(filterCounts(listedRows(viewsWith(400), NOW), NOW));
      expect(filterCounts(old, NOW).all).toBe(6);
    });

    it('never says everything is in the library while only declined requests are listed', () => {
      const one = listedRows(assembleBuildRequests({ issues: [tag(2)].map(toBuildIssue), pulls: [], now: NOW }), NOW);
      expect(pageSentence(one)).toBe('Nothing is being built right now. One change was closed without being built this week.');
      expect(listedRows(assembleBuildRequests({ issues: [tag(9)].map(toBuildIssue), pulls: [], now: NOW }), NOW)).toEqual([]);
    });

    it('dates a declined pull request by its close date, kept in the session cache', () => {
      expect(slimPull({ number: 9, html_url: 'u', state: 'closed', closed_at: '2026-10-20T00:00:00Z' }).closed_at).toBe('2026-10-20T00:00:00Z');
      expect(toBuildPull({ number: 9, html_url: 'u', state: 'closed', closed_at: '2026-10-20T00:00:00Z' }).closedAt).toBe('2026-10-20T00:00:00Z');
    });

    it("draws the row thumbnail from the request's own pictures, labelled with its component", () => {
      const v = viewsWith(2).find((x) => x.number === 489)!;
      expect(rowThumb(v, tag(2).body)).toEqual({ kind: 'image', before, after, label: 'Tag' });
    });

    it('falls back to the component placeholder, labelled with the right component, never a default one', () => {
      const views = viewsWith(2);
      const button = views.find((x) => x.component === 'Button')!;
      const { issues } = sampleBuildData(NOW);
      expect(rowThumb(button, issues.find((i) => i.number === 41)!.body)).toEqual({ kind: 'icon', icon: 'component', label: 'Button' });
      const v = views.find((x) => x.number === 489)!;
      expect(rowThumb(v, null)).toEqual({ kind: 'icon', icon: 'component', label: 'Tag' });
      expect(rowThumb({ ...v, kind: 'pull' }, tag(2).body)).toEqual({ kind: 'icon', icon: 'component', label: 'Tag' });
    });
  });
});

describe('Being built: explorations handed to developers', () => {
  const DAY = 86_400_000;
  const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
  const block = (x: Record<string, unknown>) => `## Exploration\n\n<!-- bridge-exploration ${JSON.stringify({ purpose: '', ...x })} -->`;
  const products: ProductConfig[] = [...DEFAULT_PRODUCTS, { key: 'shop', name: 'Shop' } as ProductConfig];
  const pull = (n: number, x: Partial<RestPull> & { done?: Record<string, unknown> | null; name?: string }): RestPull => ({
    number: n,
    title: `Exploration: ${x.name ?? `thing ${n}`}`,
    html_url: `https://github.com/acme/ds/pull/${n}`,
    state: 'open',
    draft: true,
    merged_at: null,
    created_at: iso(20),
    updated_at: iso(1),
    labels: ['ready-for-devs'],
    user: { login: 'ann' },
    assignees: [],
    head: { ref: `explore/thing-${n}`, sha: 'h1' },
    body: block({ name: x.name ?? `thing ${n}`, author: 'ann', ...(x.done === null ? {} : { doneAt: iso(2), doneSha: 'h1', doneBy: 'ann', ...x.done }) }),
    ...x,
  });
  const nameOf = (l: string) => (l === 'ann' ? 'Ann' : l);
  const rows = (pulls: RestPull[]) => explorationBuildRows(pulls, { products, now: NOW, nameOf });

  it('lists each handed-off status in its tab, and leaves running, archived, closed and older shipped ones out', () => {
    const list = rows([
      // Waiting for code, for the admin product: the label could not be removed, Done exploring in the body stands (#611).
      pull(611, { name: 'explore new design pr being built', labels: ['exploration', 'product: admin', 'visual-change'] }),
      // Developers pushed past the head Done exploring left.
      pull(2, { name: 'Billing screen', head: { ref: 'explore/billing', sha: 'h2' }, assignees: [{ login: 'theo' }] }),
      // Marked ready for review.
      pull(3, { name: 'Profile page', draft: false }),
      // Merged this week, and three weeks ago.
      pull(4, { name: 'Wishlist', state: 'closed', merged_at: iso(1) }),
      pull(5, { name: 'Old one', state: 'closed', merged_at: iso(21) }),
      // Running, archived, closed without merging, a plain pull request.
      pull(6, { labels: ['exploration'], done: null }),
      pull(7, { labels: ['ready-for-devs', 'archived'] }),
      pull(8, { state: 'closed' }),
      { ...pull(9, {}), body: 'Fixes the button', head: { ref: 'fix/button', sha: 'x' }, labels: [] },
    ]);
    expect(list.map((r) => `${r.number}:${r.status}:${r.label}`)).toEqual(['611:requested:Waiting for code', '2:in-progress:Being built', '3:in-review:In review', '4:shipped:Shipped']);
    const [ready, building, , shipped] = list;
    expect(ready).toMatchObject({ title: 'Explore new design pr being built', requestedBy: 'ann', builders: [], stale: false, exploration: { href: 'changes/?exploration=611', product: 'Admin demo' } });
    expect(ready!.exploration.line).toMatch(/^Admin demo · Done exploring by Ann on /);
    expect(building!.builders).toEqual(['theo']);
    expect(building!.exploration.line).toMatch(/Developers are building it$/);
    expect(shipped!.exploration.line).toBe('Shipped 1 day ago');
    expect(filterCounts(list, NOW)).toEqual({ all: 4, waiting: 1, 'in-progress': 1, 'in-review': 1, 'shipped-this-week': 1 });
    // In review names who must review: nobody asked by name, no approver known.
    expect(list[2]!.exploration.line).toMatch(/Waiting for a reviewer$/);
    expect(list.map((r) => r.exploration.line).join(' ')).not.toMatch(/—/);
  });

  it('opens an exploration of a product repository with its product, never confused with the same number in the library', () => {
    const own = { ...pull(12, { name: 'Checkout flow' }), product: 'shop', html_url: 'https://github.com/acme/shop/pull/12' };
    const list = rows([pull(12, { name: 'Pill buttons' }), own]);
    expect(list.map((r) => [r.id, r.exploration.href, r.exploration.product])).toEqual([
      ['exploration-12', 'changes/?exploration=12', null],
      ['exploration-shop#12', 'changes/?exploration=12&product=shop', 'Shop'],
    ]);
    expect(list[1]!.pull).toBeNull();
    // Without who said it (said before Bridge recorded it): the date alone.
    const older = rows([pull(13, { done: { doneBy: undefined } })])[0]!;
    expect(older.exploration.line).toMatch(/^Done exploring on \w+ \d+$/);
    expect(older.requestedBy).toBe('ann');
  });

  it('waits more than a week: highlighted, and counted in the sentence and the merged list', () => {
    const late = rows([pull(14, { done: { doneAt: iso(9) } })]);
    expect(late[0]).toMatchObject({ status: 'requested', stale: true });
    const views = sample();
    const all = listedRows(mergeRows(views, late), NOW);
    expect(all).toHaveLength(7);
    expect(pageSentence(all)).toBe('2 being built, 1 in review, 3 waiting for a developer, 2 for more than a week.');
  });

  it('keeps the exploration block of a long body in the session cache, and the head commit', () => {
    const long = pull(15, {});
    long.body = `${'x'.repeat(5000)}\n\n${long.body}`;
    const slim = slimPull(long);
    expect(slim.body!.length).toBeLessThan(4400);
    expect(slim.head).toEqual({ ref: 'explore/thing-15', sha: 'h1' });
    expect(rows([slim])[0]).toMatchObject({ status: 'requested', title: 'Thing 15' });
  });

  it('splits Being built into In review with who must review, from the reviews read', () => {
    const asked = pull(20, { name: 'Cards', draft: false, requested_reviewers: [{ login: 'florian' }] });
    const draftAsked = pull(21, { name: 'Tabs', requested_reviewers: [{ login: 'lee' }], head: { ref: 'explore/tabs', sha: 'h9' } });
    const changes = pull(22, { name: 'Lists', draft: false });
    const approvers = pull(23, { name: 'Menus', draft: false });
    const names = (l: string) => ({ florian: 'Florian', lee: 'Lee', dana: 'Dana' })[l] ?? l;
    const list = explorationBuildRows([asked, draftAsked, changes, approvers], {
      products,
      now: NOW,
      nameOf: names,
      approvers: ['dana'],
      reviews: (k) => (k === '22' ? [{ user: { login: 'lee' }, state: 'CHANGES_REQUESTED' }] : null),
    });
    expect(list.map((r) => [r.number, r.status, r.reviewLine])).toEqual([
      [20, 'in-review', "Waiting for Florian's review"],
      [21, 'in-review', "Waiting for Lee's review"],
      [22, 'in-review', 'Changes requested by Lee'],
      [23, 'in-review', "Waiting for Dana's review"],
    ]);
    expect(rowLine(list[0]!, NOW)).toMatch(/Waiting for Florian's review$/);
    expect(statusTag(list[0]!)).toEqual({ label: 'In review', tone: 'warning' });
    expect(list.filter((r) => matchesBuildTab(r, 'in-review', NOW))).toHaveLength(4);
    expect(list.filter((r) => matchesBuildTab(r, 'in-progress', NOW))).toHaveLength(0);
    // The viewer asked: their own words.
    const mine = explorationBuildRows([asked], { products, now: NOW, nameOf: names, viewer: 'florian' });
    expect(mine[0]!.reviewLine).toBe('Waiting for your review');
  });

  it('reads a merged library exploration as In the next release until the library is published, whatever its age', () => {
    const merged = { ...pull(30, { name: 'Pills', state: 'closed', merged_at: iso(20) }), merge_commit_sha: 'abc1234def' };
    const recent = { ...pull(31, { name: 'Chips', state: 'closed', merged_at: iso(1) }), merge_commit_sha: 'fff0000aaa' };
    const nextRelease = (p: RestPull) => (p.merge_commit_sha ?? '').startsWith('abc1234');
    const list = explorationBuildRows([merged, recent], { products, now: NOW, nameOf, nextRelease });
    expect(list.map((r) => [r.number, r.label, r.nextRelease ?? false, r.exploration.line])).toEqual([
      [30, 'In the next release', true, 'In the next release'],
      [31, 'Shipped', false, 'Shipped 1 day ago'],
    ]);
    expect(statusTag(list[0]!)).toEqual({ label: 'In the next release', tone: 'info' });
    expect(list.filter((r) => matchesBuildTab(r, 'shipped-this-week', NOW))).toHaveLength(2);
  });

  it('carries the lifecycle onto build requests: In the next release, and who reviews', () => {
    const views = sample();
    const shipped = views.find((v) => v.status === 'shipped')!;
    const review = views.find((v) => v.status === 'in-review')!;
    const pulls: RestPull[] = [
      { number: shipped.pull!.number, html_url: '', state: 'closed', merged_at: iso(2), merge_commit_sha: 'abc1234ff' },
      { number: review.pull!.number, html_url: '', state: 'open', draft: false, requested_reviewers: [{ login: 'lee' }] },
    ];
    const out = withLifecycle(views, { pulls, nextRelease: (p) => p.merge_commit_sha === 'abc1234ff', nameOf: (l) => (l === 'lee' ? 'Lee' : l) });
    const s2 = out.find((v) => v.id === shipped.id)!;
    expect(s2.nextRelease).toBe(true);
    expect(rowLine(s2, NOW)).toBe('In the next release');
    const r2 = out.find((v) => v.id === review.id)!;
    expect(rowLine(r2, NOW)).toMatch(/· Waiting for Lee's review$/);
    // Nothing read about it: the row keeps its words.
    expect(withLifecycle(views, { pulls: [] })).toEqual(views);
  });

  it('keeps the release pull request body whole, and the merge commit and requested reviewers', () => {
    const release: RestPull = { number: 99, html_url: '', state: 'open', head: { ref: 'changeset-release/main' }, body: 'x'.repeat(9000) };
    expect(slimPull(release).body).toHaveLength(9000);
    expect(slimPull({ ...pull(40, {}), merge_commit_sha: 'abc', requested_reviewers: [{ login: 'lee' }] })).toMatchObject({ merge_commit_sha: 'abc', requested_reviewers: [{ login: 'lee' }] });
  });
});
