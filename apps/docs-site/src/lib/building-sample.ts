// Sample build requests: the sample team of the demo (Acme Design, lib/demo.ts isSampleTeam) shows these on Being
// built, read only, so a visitor sees every status without Bridge reading or writing GitHub for them. The local dev
// fixtures (dev/local-github.ts) serve the same data for a fixture team, so `npm run dev:full` shows it through the real
// read path. Dates are relative to `now`. Pure, covered by building-view.test.ts.
import { composeBuildRequestIssue, type BuildRequestInput } from '@bridge-ds/core';
import type { RestIssue, RestPull } from './building-view';

const DAY = 86_400_000;

/** The sample people: Dana leads the design system and pushes from Figma, Ana and Theo build. */
export const SAMPLE_BUILDERS: Record<string, string> = { dana: 'Dana', ana: 'Ana', theo: 'Theo' };

type Seed = { n: number; input: Omit<BuildRequestInput, 'source' | 'requestedBy' | 'figma'> & { figmaName: string }; ago: number; assignees?: string[]; closed?: { ago: number; reason: 'completed' | 'not_planned' }; pull?: { n: number; author: string; draft: boolean; ago: number; merged?: number } };

const SEEDS: Seed[] = [
  {
    n: 41,
    ago: 1,
    input: {
      component: 'Button',
      kind: 'new-variant',
      title: 'Add a lg size',
      summary: 'Hero sections need a larger button that keeps the label on one line.',
      line: 'A new size lg: 48 px high, label in body large.',
      changes: [{ field: 'size', before: 'sm | md', after: 'sm | md | lg' }],
      props: [{ name: 'size', type: 'variant', values: ['sm', 'md', 'lg'], default: 'md', change: 'changed' }],
      figmaName: 'Button',
    },
  },
  {
    n: 37,
    ago: 10,
    input: {
      component: 'Tabs',
      kind: 'structure',
      title: 'Put a count after the label',
      summary: 'Inbox tabs show how many items wait in each, like Figma comments.',
      changes: [{ field: 'layout', before: 'label', after: 'label, count badge' }],
      props: [{ name: 'count', type: 'number', change: 'new', note: 'Hidden when empty' }],
      figmaName: 'Tabs / With count',
    },
  },
  {
    n: 39,
    ago: 4,
    assignees: ['ana'],
    input: {
      component: 'Card',
      kind: 'structure',
      title: 'New header layout',
      summary: 'The card header holds an icon, the title and one action on the same line.',
      changes: [{ field: 'header', before: 'title', after: 'icon, title, action' }],
      props: [{ name: 'action', type: 'slot', change: 'new' }],
      figmaName: 'Card / Header',
    },
  },
  {
    n: 35,
    ago: 6,
    pull: { n: 52, author: 'theo', draft: true, ago: 2 },
    input: {
      component: 'Select',
      kind: 'prop-change',
      title: 'Add a clear button',
      summary: 'Filters need a way to empty a select in one click.',
      props: [{ name: 'clearable', type: 'boolean', default: 'false', change: 'new' }],
      changes: [{ field: 'clearable', after: 'true | false' }],
      figmaName: 'Select / Clearable',
    },
  },
  {
    n: 33,
    ago: 8,
    assignees: ['ana'],
    pull: { n: 50, author: 'ana', draft: false, ago: 3 },
    input: {
      component: 'Badge',
      kind: 'new-variant',
      title: 'Add an info tone',
      summary: 'Release notes tag new features with a calm blue badge.',
      props: [{ name: 'tone', type: 'variant', values: ['neutral', 'success', 'warning', 'danger', 'info'], change: 'changed' }],
      changes: [{ field: 'tone', after: '+ info' }],
      figmaName: 'Badge / Info',
    },
  },
  {
    n: 30,
    ago: 12,
    assignees: ['theo'],
    closed: { ago: 2, reason: 'completed' },
    pull: { n: 47, author: 'theo', draft: false, ago: 7, merged: 2 },
    input: {
      component: 'Avatar',
      kind: 'new-variant',
      title: 'Add an xs size',
      summary: 'Dense tables show a 20 px avatar next to the name.',
      props: [{ name: 'size', type: 'variant', values: ['xs', 'sm', 'md', 'lg'], change: 'changed' }],
      changes: [{ field: 'size', after: '+ xs' }],
      figmaName: 'Avatar / xs',
    },
  },
];

const iso = (now: number, days: number) => new Date(now - days * DAY).toISOString();
/** Labels and heads as GitHub answers them (objects, a commit sha): the local fixtures serve these to every reader. */
const named = (labels: string[]) => labels.map((name) => ({ name }));
const sha = (n: number) => n.toString(16).padStart(40, '0');

/** The sample issues and pull requests, as GitHub's REST API would answer for the sample team. */
export function sampleBuildData(now: number, repo = 'acme/design-system'): { issues: RestIssue[]; pulls: RestPull[] } {
  const issues: RestIssue[] = [];
  const pulls: RestPull[] = [];
  for (const s of SEEDS) {
    const { figmaName, ...rest } = s.input;
    const issue = composeBuildRequestIssue({ ...rest, source: 'figma', requestedBy: 'dana', figma: { nodeName: figmaName, url: `https://www.figma.com/design/acme/Acme-Design-System?node-id=${s.n}-1` } });
    issues.push({
      number: s.n,
      title: issue.title,
      body: issue.body,
      html_url: `https://github.com/${repo}/issues/${s.n}`,
      state: s.closed ? 'closed' : 'open',
      state_reason: s.closed?.reason ?? null,
      labels: named([...issue.labels, ...(s.n === 33 ? ['jira: DS-128'] : [])]),
      user: { login: 'dana' },
      assignees: (s.assignees ?? []).map((login) => ({ login })),
      created_at: iso(now, s.ago),
      closed_at: s.closed ? iso(now, s.closed.ago) : null,
    });
    if (s.pull) {
      pulls.push({
        number: s.pull.n,
        title: `${s.input.component}: ${s.input.title.charAt(0).toLowerCase()}${s.input.title.slice(1)}`,
        body: `Builds the change sent from Figma.\n\nCloses #${s.n}`,
        html_url: `https://github.com/${repo}/pull/${s.pull.n}`,
        state: s.pull.merged ? 'closed' : 'open',
        draft: s.pull.draft,
        merged_at: s.pull.merged ? iso(now, s.pull.merged) : null,
        created_at: iso(now, s.pull.ago),
        updated_at: iso(now, s.pull.merged ?? 0),
        labels: [],
        user: { login: s.pull.author },
        assignees: [],
        head: { ref: `agent/build-${s.n}`, sha: sha(s.pull.n) },
      });
    }
  }
  // The Button request also has its library branch from Figma, opened by the sender with the spec only (direct mode):
  // one build request per change, so it reads as the issue alone, still waiting for a developer.
  pulls.push({
    number: 53,
    title: 'Button: add a lg size',
    body: `Spec from Figma for a developer to build with Claude.\n\nCloses #41`,
    html_url: `https://github.com/${repo}/pull/53`,
    state: 'open',
    draft: true,
    merged_at: null,
    created_at: iso(now, 1),
    updated_at: iso(now, 1),
    labels: named(['from-figma', 'component-change', 'waiting-for-claude']),
    user: { login: 'dana' },
    assignees: [],
    head: { ref: 'bridge/button-add-a-lg-size', sha: sha(53) },
  });
  return { issues, pulls };
}
