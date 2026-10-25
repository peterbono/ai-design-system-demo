import { describe, expect, it } from 'vitest';
import { assembleBuildRequests, figmaAheadLine, buildSummaryLine } from '@bridge-ds/core';
import { sampleBuildData, SAMPLE_BUILDERS } from './building-sample';
import { ageLabel, buildDetail, detailFromQuery, detailQuery, filterCounts, jiraLink, pageSentence, propLine, rowLine, slimIssue, slimPull, statusTag, timelineSteps, toBuildIssue, toBuildPull } from './building-view';

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
    expect(filterCounts(views, NOW)).toEqual({ all: 6, waiting: 2, 'in-progress': 3, 'shipped-this-week': 1 });
    expect(pageSentence(views)).toBe('3 being built, 2 waiting for a developer, 1 for more than a week.');
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
});
