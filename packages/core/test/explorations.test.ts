// Explorations: branch naming, the draft pull request body, status, the promotion plan, requests on an exploration,
// and the GitHub helpers (start, list, promote, close) over a small in-memory GitHub.
import { describe, expect, it } from 'vitest';
import {
  closeExplorationOnGitHub,
  composeRequestIssue,
  EXPLORATION_LABEL,
  explorationBranch,
  explorationNote,
  explorationPrBody,
  explorationPrTitle,
  explorationProblems,
  explorationSlug,
  explorationSlugFromBranch,
  explorationShareMessage,
  explorationStatus,
  explorationTryIt,
  explorationTryItOnGitHub,
  GitHubClient,
  GitHubError,
  isExplorationBranch,
  isExplorationPull,
  listExplorationsOnGitHub,
  parseExplorationBody,
  parseRequestIssue,
  findPreviewComment,
  installCommandFromPreviewComment,
  PREVIEW_COMMENT_MARKER,
  previewComment,
  readPreviewComment,
  promoteExplorationOnGitHub,
  productRepoAccess,
  promotionPlan,
  requestBrief,
  startExplorationOnGitHub,
  labelExploration,
  isUnlabeledExploration,
  type ComponentChangeRequest,
  type FetchLike,
} from '../src/index';
import { realConfig } from './helpers';
import {
  archiveExplorationOnGitHub,
  doneExploringOnGitHub,
  doneExploringPlan,
  EXPLORATION_READY_LABEL,
  isHeldExploration,
  parsePiecesRecord,
  pieceRequest,
  reviewQueue,
  withDoneExploring,
  withPiecesRecord,
  type MissingPiece,
} from '../src/index';
import { EXPLORATION_STARTING_POINT, explorationStartingPoint } from '../src/explorations';
import { libraryBranchPlan, withNeededBy } from '../src/prod-branch';

const BADGE: MissingPiece = {
  id: 'badge-overdue-tone',
  kind: 'variant',
  title: 'Badge: overdue tone',
  summary: 'The branch paints a Badge #fff4f4 on #9d0639.',
  name: 'overdue',
  component: 'Badge',
  aspect: 'tone',
  values: [{ category: 'color', property: 'background-color', value: '#fff4f4' }],
  nearest: { token: 'color.feedback.danger.bg', cssVar: '--color-feedback-danger-bg', value: '#fff4f4', level: 'high', label: 'danger' },
  where: [{ file: 'apps/admin/src/Billing.tsx', line: 12 }],
};
const TOKEN: MissingPiece = {
  id: 'color-c2410c',
  kind: 'token',
  title: 'New color #C2410C',
  summary: 'A hand-written color.',
  name: 'c2410c',
  values: [{ category: 'color', value: '#c2410c' }],
  where: [],
  token: { path: 'color.feedback.overdue.text', type: 'color', value: '#c2410c', files: [] },
};

describe('done exploring: status, plan and body', () => {
  it('status after done exploring: waiting for code, being built once developers push or mark it ready, shipped once merged', () => {
    const body = withDoneExploring(explorationPrBody({ name: 'Pill buttons', purpose: 'Rounder.' }, { owner: 'acme', repo: 'ds', packages, apps }), { branch: 'explore/pill-buttons', doneAt: '2026-10-30T09:00:00Z', doneSha: 'aaa' });
    const base = { state: 'open', labels: [EXPLORATION_READY_LABEL], body, draft: true };
    expect(explorationStatus({ ...base, headSha: 'aaa' })).toBe('ready');
    expect(explorationStatus({ ...base, headSha: 'bbb' })).toBe('building');
    expect(explorationStatus({ ...base, headSha: 'aaa', draft: false })).toBe('building');
    expect(explorationStatus({ ...base, state: 'closed', merged_at: '2026-11-01' })).toBe('shipped');
    expect(explorationStatus({ ...base, state: 'closed' })).toBe('closed');
    // The label could not be removed (a token without the right to edit labels): done exploring still stands.
    expect(explorationStatus({ ...base, labels: [EXPLORATION_LABEL], headSha: 'aaa' })).toBe('ready');
    // Held out of the review queue while it runs, is archived, or is with the developers as a draft.
    expect(isHeldExploration({ state: 'open', labels: [EXPLORATION_READY_LABEL], draft: true })).toBe(true);
    expect(isHeldExploration({ state: 'open', labels: [EXPLORATION_READY_LABEL], draft: false })).toBe(false);
    expect(isHeldExploration({ state: 'open', labels: ['archived'] })).toBe(true);
    const q = (labels: string[], draft = true) => ({ state: 'open', draft, labels, head: { ref: 'explore/x' }, user: { login: 'ann' } });
    expect(reviewQueue([q(['exploration']), q([EXPLORATION_READY_LABEL]), q([EXPLORATION_READY_LABEL], false), q(['archived'], false)])).toHaveLength(1);
  });

  it('plan: label swap, note removed, never closes, merges or marks ready; the body says how developers take it', () => {
    const e = { name: 'Pill buttons', purpose: 'Rounder.', author: 'ann' };
    const body = explorationPrBody(e, { owner: 'acme', repo: 'ds', packages, apps });
    const plan = doneExploringPlan({ body, branch: 'explore/pill-buttons', files: [{ path: '.bridge/explorations/pill-buttons.md', status: 'added' }, { path: 'a.css' }], date: new Date('2026-10-30T09:00:00Z') });
    expect(plan).toMatchObject({ removeLabels: ['exploration'], addLabels: ['ready-for-devs'], removeFiles: ['.bridge/explorations/pill-buttons.md'], markReady: false, take: ['git fetch origin', 'git checkout explore/pill-buttons'] });
    expect(plan.body).not.toContain('Not mergeable as is');
    expect(plan.body).not.toContain('### When it is done');
    expect(plan.body).toContain('### For developers');
    expect(plan.body).toContain('git checkout explore/pill-buttons');
    expect(plan.body).toMatch(/starting point, not ready to ship/);
    expect(plan.body).not.toMatch(/—/);
    expect(parseExplorationBody(plan.body)).toMatchObject({ name: 'Pill buttons', author: 'ann', doneAt: '2026-10-30T09:00:00.000Z' });
    // Again with the head: one developer section, the block updated.
    const again = withDoneExploring(plan.body, { branch: 'explore/pill-buttons', doneAt: '2026-10-30T09:00:00.000Z', doneSha: 'c9' });
    expect(again.match(/### For developers/g)).toHaveLength(1);
    expect(parseExplorationBody(again)?.doneSha).toBe('c9');
  });

  it('pieceRequest: always a request for the DS lead, with the preview link and who needs it', () => {
    const ref = { pr: 12, title: 'Billing screen', branch: 'explore/billing', url: 'https://github.com/acme/ds/pull/12', productKey: 'admin', productName: 'Admin demo', author: 'ann' };
    const v = pieceRequest(BADGE, ref, { previewUrl: 'https://admin-git-explore-billing.vercel.app/', source: 'studio', requestedBy: 'ann' });
    expect(v.request).toMatchObject({ component: 'Badge', kind: 'new-variant', title: 'Badge: overdue tone', source: 'studio', requestedBy: 'ann' });
    expect(v.request.summary).toContain("in the exploration's preview: https://admin-git-explore-billing.vercel.app/");
    expect(v.neededBy).toMatchObject({ pr: 12, piece: 'badge-overdue-tone', nearest: 'danger', nearestValue: '#fff4f4' });
    const t = pieceRequest(TOKEN, ref);
    expect(t.request).toMatchObject({ component: 'Tokens', kind: 'other', title: 'Add color.feedback.overdue.text', changes: [{ field: 'color.feedback.overdue.text', after: '#c2410c' }] });
    expect(t.request.summary).toContain('https://github.com/acme/ds/pull/12');
  });
});

describe('done exploring: request wording and the developer note', () => {
  const ref = { pr: 1, title: 'Wishlist button on product cards', branch: 'explore/wishlist', url: 'https://github.com/acme/shop/pull/1', productKey: 'shop', productName: 'Demo shop', author: 'ann', repo: 'acme/shop' };
  // The piece behind acme/ds#623: a hand-picked colour on IconButton, near the danger icon colour.
  const WISHLIST: MissingPiece = {
    id: 'iconbutton-wishlist-tone',
    kind: 'variant',
    title: 'IconButton: wishlist tone',
    summary: 'IconButton restyled by hand (color #E11D48). The closest in the library is danger.',
    name: 'wishlist',
    component: 'IconButton',
    aspect: 'tone',
    values: [{ category: 'color', property: 'color', value: '#E11D48' }],
    nearest: { token: 'color.feedback.danger.icon', cssVar: '--color-feedback-danger-icon', value: '#c3184c', level: 'medium', label: 'danger' },
    where: [],
  };

  it('says the closest library value once and leaves out an empty "Now" column', () => {
    const { request, neededBy } = pieceRequest(WISHLIST, ref, { source: 'cli', requestedBy: 'ann' });
    const body = withNeededBy(composeRequestIssue(request).body, neededBy);
    const readable = body.replace(/<!--[\s\S]*?-->/g, '');
    expect(readable.match(/closest/gi)).toHaveLength(1);
    expect(readable).toContain('The closest the library has today is danger (`color.feedback.danger.icon`, #c3184c).');
    expect(readable).toContain('| What | Requested |');
    expect(readable).toContain('| color | #E11D48 |');
    expect(readable).not.toContain('| Now |');
    // A request that knows what is there today keeps the column.
    expect(composeRequestIssue({ ...request, changes: [{ field: 'radius', before: 'control', after: 'pill' }] }).body).toContain('| What | Now | Requested |');
  });

  it('a token-only restyle asks for the state on its component, with the part it lands on', () => {
    const restyle: MissingPiece = {
      id: 'iconbutton-pressed-restyle',
      kind: 'variant',
      title: 'IconButton: restyled when pressed',
      summary: 'IconButton restyled from outside the library when pressed, with tokens only (icon fill currentColor).',
      name: 'pressed',
      component: 'IconButton',
      aspect: 'state',
      values: [{ category: 'color', property: 'fill', value: 'currentColor', part: 'icon' }],
      where: [],
      restyle: { state: 'pressed', selector: ".product-wishlist[aria-pressed='true'] svg" },
    };
    const { request } = pieceRequest(restyle, ref);
    expect(request).toMatchObject({ component: 'IconButton', kind: 'new-variant', title: 'IconButton: restyled when pressed', changes: [{ field: 'fill (icon)', after: 'currentColor' }] });
    const plan = libraryBranchPlan(restyle, ref);
    if (plan.kind !== 'exploration') throw new Error(plan.kind);
    expect(plan.exploration.purpose).toContain('a look when pressed on IconButton (fill (icon) currentColor)');
    expect(plan.brief).toMatch(/restyles IconButton from outside with tokens/);
    expect(plan.brief).not.toMatch(/writes it by hand/);
  });

  it('the developer note follows the branch checks and never claims untested code when checks pass', () => {
    expect(explorationStartingPoint('success')).toMatch(/^A starting point: its checks pass, but nobody has reviewed/);
    expect(explorationStartingPoint('success')).not.toMatch(/not ready to ship|not reviewed or tested/);
    expect(explorationStartingPoint('failure')).toMatch(/some checks fail/);
    expect(explorationStartingPoint('none')).toMatch(/no checks ran/);
    expect(explorationStartingPoint('pending')).toMatch(/still running/);
    expect(explorationStartingPoint()).toBe(EXPLORATION_STARTING_POINT);
    expect(EXPLORATION_STARTING_POINT).not.toMatch(/tested/);
    for (const c of ['success', 'failure', 'pending', 'none'] as const) expect(explorationStartingPoint(c)).not.toMatch(/\u2014/);
    const body = withDoneExploring('## Exploration: Wishlist', { branch: 'explore/wishlist', doneAt: '2026-10-30T09:00:00Z', checks: 'success' });
    expect(body).toContain('its checks pass');
  });
});

describe('done exploring and archive on GitHub', () => {
  it('sends the ticked pieces as requests, swaps the labels, removes the note, keeps it open and a draft', async () => {
    const gh = fakeGitHub();
    const c = gh.client();
    await startExplorationOnGitHub(c, { name: 'Billing screen', purpose: 'Overdue invoices.' }, { ...settings, labels: ['product: admin'] });
    gh.pulls[0].body = withPiecesRecord(gh.pulls[0].body, { checkedAt: '2026-10-30', pieces: [BADGE, TOKEN], links: [] });

    const dry = await doneExploringOnGitHub(c, 'billing-screen', { pieces: ['badge-overdue-tone'], dryRun: true });
    expect(dry.pieces.proposed.map((x) => x.piece)).toEqual(['badge-overdue-tone']);
    expect(gh.issues).toHaveLength(0);
    expect(gh.pulls[0].labels.map((l: any) => l.name)).toContain('exploration');

    const r = await doneExploringOnGitHub(c, 1, { pieces: ['badge-overdue-tone', 'nope'], previewUrl: 'https://admin-preview.vercel.app/', openedBy: 'ann', source: 'studio' });
    expect(r).toMatchObject({ number: 1, status: 'ready', handedOff: true, warnings: [], take: ['git fetch origin', 'git checkout explore/billing-screen'] });
    expect(r.pieces.unknown).toEqual(['nope']);
    expect(r.note).toBe(explorationStartingPoint(r.checks));
    expect(gh.issues).toHaveLength(1);
    expect(gh.issues[0].labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['component-change', 'needed-by-product']));
    expect(gh.issues[0].body).toContain('https://admin-preview.vercel.app/');
    expect(gh.issues[0].body).toContain('**Needed by:**');
    const pr = gh.pulls[0];
    expect(pr.state).toBe('open');
    expect(pr.draft).toBe(true);
    expect(pr.labels.map((l: any) => l.name).sort()).toEqual(['product: admin', 'ready-for-devs']);
    expect(gh.trees.get(gh.refs.get('explore/billing-screen')!)!.has('.bridge/explorations/billing-screen.md')).toBe(false);
    expect(parsePiecesRecord(pr.body)!.links.map((l) => [l.piece, l.kind, l.number])).toEqual([['badge-overdue-tone', 'request', 100]]);
    expect(pr.body).toContain('### For developers');
    expect(gh.calls.some((x) => x.path === '/graphql')).toBe(false);
    expect((await listExplorationsOnGitHub(c, settings)).map((x) => x.status)).toEqual(['ready']);

    // Said again: only the newly ticked piece, never twice.
    const again = await doneExploringOnGitHub(c, 1, { pieces: ['badge-overdue-tone', 'color-c2410c'] });
    expect(again).toMatchObject({ handedOff: false, status: 'ready' });
    expect(again.pieces.already).toEqual([{ piece: 'badge-overdue-tone', number: 100 }]);
    expect(gh.issues).toHaveLength(2);

    // A developer pushes: being built.
    await c.withBranchPrefix('explore/').commitToBranch({ branch: 'explore/billing-screen', message: 'feat: real code', files: [{ path: 'apps/admin/x.ts', content: 'x' }] });
    expect((await listExplorationsOnGitHub(c, settings)).map((x) => x.status)).toEqual(['building']);
    await expect(doneExploringOnGitHub(gh.client(''), 1)).rejects.toThrow(/needs a GitHub token/);
  });

  it('archive: a label on the open pull request, hidden from the default list, back with unarchive', async () => {
    const gh = fakeGitHub();
    const c = gh.client();
    await startExplorationOnGitHub(c, { name: 'Pill buttons', purpose: 'Rounder.' }, settings);
    expect(await archiveExplorationOnGitHub(c, 'pill-buttons')).toMatchObject({ number: 1, archived: true });
    expect(gh.pulls[0].state).toBe('open');
    expect(await listExplorationsOnGitHub(c, settings)).toEqual([]);
    expect((await listExplorationsOnGitHub(c, settings, { archived: 'only' })).map((x) => [x.number, x.archived])).toEqual([[1, true]]);
    await archiveExplorationOnGitHub(c, 1, { archived: false });
    expect((await listExplorationsOnGitHub(c, settings)).map((x) => x.archived)).toEqual([false]);
    await expect(archiveExplorationOnGitHub(gh.client(''), 1)).rejects.toThrow(/needs a GitHub token/);
  });
});

const apps = { docs: 'https://bridge-docs-git-{branch}-acme.vercel.app', storybook: 'https://sb-git-{branch}-acme.vercel.app' };
const packages = ['@bridge-ds/tokens', '@bridge-ds/react'];
const settings = { base: 'main', packages, apps };
const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('exploration naming', () => {
  it('slugs names into explore/<slug> branches', () => {
    expect(explorationSlug('Denser data tables!')).toBe('denser-data-tables');
    expect(explorationSlug('explore/Pill buttons')).toBe('pill-buttons');
    expect(explorationSlug('   ')).toBe('');
    expect(explorationBranch('Pill buttons')).toBe('explore/pill-buttons');
    expect(explorationBranch('explore/pill-buttons')).toBe('explore/pill-buttons');
    expect(isExplorationBranch('explore/pill-buttons')).toBe(true);
    expect(isExplorationBranch('refs/heads/explore/pill-buttons')).toBe(true);
    expect(isExplorationBranch('explore/')).toBe(false);
    expect(isExplorationBranch('explore/Pill_Buttons')).toBe(false);
    expect(isExplorationBranch('agent/pill')).toBe(false);
    expect(explorationSlugFromBranch('explore/pill-buttons')).toBe('pill-buttons');
    expect(explorationSlugFromBranch('main')).toBeNull();
  });

  it('keeps a short phrase whole and cuts a long one on a word boundary', () => {
    expect(explorationSlug('Exploration page: pick up where you left off')).toBe('exploration-page-pick-up-where-you-left-off');
    const long = explorationSlug('Checkout redesign with saved cards and express wallets for returning buyers');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toBe('checkout-redesign-with-saved-cards-and-express-wallets-for');
  });

  it('titles the pull request with the name as typed, the prefix once', () => {
    expect(explorationPrTitle({ name: 'Exploration page: pick up where you left off' })).toBe('Exploration: Exploration page, pick up where you left off');
    expect(explorationPrTitle({ name: 'Exploration: denser tables' })).toBe('Exploration: denser tables');
    expect(explorationPrTitle({ name: 'iOS tab bar.' })).toBe('Exploration: iOS tab bar');
    expect(explorationPrTitle({ name: 'Orders: bulk actions' })).toBe('Exploration: Orders, bulk actions');
  });

  it('says how to fix a name, and never asks for a purpose', () => {
    expect(explorationProblems({ name: 'Pill buttons', purpose: 'Do rounder buttons read as more friendly?' })).toEqual([]);
    expect(explorationProblems({ name: 'Pill buttons', purpose: '' })).toEqual([]);
    expect(explorationProblems({ name: 'Pill buttons' })).toEqual([]);
    expect(explorationProblems({ name: '', purpose: '' })).toEqual(['Name the exploration, for example "Denser data tables".']);
    expect(explorationProblems({ name: '!!!', purpose: 'x' })[0]).toMatch(/letters or digits/);
    expect(explorationProblems({ name: 'x'.repeat(61), purpose: 'x' })[0]).toMatch(/under 60/);
  });
});

describe('exploration pull request', () => {
  const e = { name: 'Pill buttons', purpose: 'Do rounder buttons read as more friendly in the checkout?', useCase: 'user-test' as const, author: 'designer', startedAt: '2026-10-17T09:00:00Z' };

  it('composes a draft body with purpose, install, previews and promote or close, and reads it back', () => {
    const body = explorationPrBody(e, { owner: 'acme', repo: 'ds', pr: 12, packages, apps, requests: [{ number: 40, title: 'Button: pill radius' }] });
    expect(explorationPrTitle(e)).toBe('Exploration: Pill buttons');
    expect(body).toContain('## Exploration: Pill buttons');
    expect(body).toContain('Not mergeable as is');
    expect(body).toContain('**Use case.** Prototype for a user test');
    // No guessed install command (pkg.pr.new may not be set up): the sticky comment has the one that works.
    expect(body).not.toContain('pkg.pr.new');
    expect(body).toContain('"Try this exploration in your product" comment');
    expect(body).toContain('| Docs | https://bridge-docs-git-explore-pill-buttons-acme.vercel.app/ |');
    expect(body).toContain('- #40 Button: pill radius');
    expect(body).toContain('bridge explore done pill-buttons');
    expect(body).toContain('bridge explore archive pill-buttons');
    expect(body).toContain('Keep this pull request open');
    expect(body).not.toMatch(/\u2014/);
    expect(parseExplorationBody(body)).toEqual({ ...e, slug: 'pill-buttons' });
    expect(parseExplorationBody('no block')).toBeUndefined();
    // Where it was started and the agent behind it travel in the block, so Studio can tell who it is.
    const byAgent = explorationPrBody({ ...e, source: 'cli', agent: 'claude' }, { owner: 'acme', repo: 'ds', packages, apps: {} });
    expect(parseExplorationBody(byAgent)).toMatchObject({ source: 'cli', agent: 'claude' });
    // Before the pull request exists the body says where the command will appear.
    expect(explorationPrBody(e, { owner: 'acme', repo: 'ds', packages, apps: {} })).toMatch(/comment below[\s\S]*Preview deploys are not set up/);
  });

  it('previews set up but the branch too long for a predictable link: the Vercel comment, never "not set up"', () => {
    const vercel = { docs: 'https://bridge-docs-git-{branch}-peterbonos-projects.vercel.app', admin: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app' };
    const body = explorationPrBody({ name: 'Exploration page: pick up where you left off', purpose: '' }, { owner: 'acme', repo: 'ds', pr: 621, packages, apps: vercel });
    expect(body).not.toContain('not set up');
    expect(body).toContain('| Docs | Link in the Vercel comment on this pull request |');
    expect(body).toContain('| Admin demo | Link in the Vercel comment on this pull request |');
  });

  it('without a purpose: no empty Purpose line, the block reads back with an empty one', () => {
    const free = { name: 'Billing screen', purpose: '' };
    const body = explorationPrBody(free, { owner: 'acme', repo: 'ds', packages, apps });
    expect(body).not.toContain('**Purpose.**');
    expect(body).not.toMatch(/\n\n\n/);
    expect(parseExplorationBody(body)).toMatchObject({ name: 'Billing screen', purpose: '' });
    // A block written without the field at all still reads.
    expect(parseExplorationBody('<!-- bridge-exploration {"name":"Free","slug":"free"} -->')).toEqual({ name: 'Free', slug: 'free', purpose: '' });
    expect(explorationNote({ ...free, slug: 'billing-screen' })).toMatch(/^# Exploration: Billing screen\n\n- Branch: `explore\/billing-screen`/);
  });

  it('in a product repository: work there, the library from npm, the product preview', () => {
    const body = explorationPrBody(
      { name: 'Billing screen', purpose: 'Overdue invoices.' },
      { owner: 'acme', repo: 'shop', pr: 7, packages: [], apps: {}, inProduct: { name: 'Shop', library: 'acme/ds', preview: 'https://shop-git-{branch}-acme.vercel.app' } },
    );
    expect(body).toContain('This exploration lives in the Shop repository');
    expect(body).toContain('`git fetch origin && git switch explore/billing-screen`');
    expect(body).toContain('The library comes from npm');
    expect(body).toContain('`npm i @bridge-ds/react@<snapshot>`');
    expect(body).toContain('Library changes are made in acme/ds, never on this branch.');
    expect(body).toContain('| Shop | https://shop-git-explore-billing-screen-acme.vercel.app/ |');
    expect(body).not.toContain('### Try it in a product staging branch');
    expect(body).not.toMatch(/\u2014/);
    expect(explorationPrBody({ name: 'Billing screen', purpose: '' }, { owner: 'acme', repo: 'shop', packages: [], apps: {}, inProduct: { name: 'Shop', library: 'acme/ds' } })).toContain('The preview deploys of Shop, if it has them');
  });

  it('note file names the branch and how it ends', () => {
    const note = explorationNote({ ...e, slug: 'pill-buttons' });
    expect(note).toContain('- Branch: `explore/pill-buttons`');
    expect(note).toContain('- Started: 2026-10-17 by @designer');
    expect(note).toContain('"Done exploring" removes it');
  });

  it('status: running while labeled and open, promoted without the label, closed when closed unmerged', () => {
    expect(explorationStatus({ state: 'open', labels: [{ name: EXPLORATION_LABEL }] })).toBe('active');
    expect(explorationStatus({ state: 'open', labels: ['tier: 2'] })).toBe('promoted');
    expect(explorationStatus({ state: 'merged', labels: [] })).toBe('promoted');
    expect(explorationStatus({ state: 'closed', merged_at: '2026-10-17', labels: [] })).toBe('promoted');
    expect(explorationStatus({ state: 'closed', labels: [EXPLORATION_LABEL] })).toBe('closed');
    expect(isExplorationPull({ state: 'open', labels: [], headRef: 'explore/x' })).toBe(true);
    expect(isExplorationPull({ state: 'open', labels: ['exploration'], headRef: 'agent/x' })).toBe(true);
    expect(isExplorationPull({ state: 'open', labels: [], headRef: 'agent/x', body: 'hi' })).toBe(false);
  });

  it('promotion plan: tier from the files (note left out), labels, review body that closes linked requests', () => {
    const body = explorationPrBody(e, { owner: 'acme', repo: 'ds', pr: 12, packages, apps });
    const plan = promotionPlan({
      title: 'Exploration: pill buttons',
      body,
      labels: [EXPLORATION_LABEL],
      files: [
        { path: '.bridge/explorations/pill-buttons.md', status: 'added' },
        { path: 'packages/tokens/src/semantic/light.tokens.json', status: 'modified' },
        { path: 'packages/react/src/components/Button/Button.module.css', status: 'modified' },
      ],
      config: realConfig(),
      requests: [40, 41],
      date: new Date('2026-10-20T00:00:00Z'),
    });
    expect(plan.tier).toBe(3);
    expect(plan.addLabels).toEqual(['tier: 3', 'tokens']);
    expect(plan.removeLabels).toEqual(['exploration']);
    expect(plan.removeFiles).toEqual(['.bridge/explorations/pill-buttons.md']);
    expect(plan.title).toBe('Pill buttons');
    expect(promotionPlan({ title: 'DS-42 Exploration: pill buttons', body: '', labels: [], files: [] }).title).toBe('DS-42 Pill buttons');
    expect(plan.body).toMatch(/^\*\*Promoted from an exploration on 2026-10-20\.\*\*/);
    expect(plan.body).toContain('**Risk tier:** 3.');
    expect(plan.body).toContain('Closes #40\nCloses #41');
    expect(plan.body).not.toContain('Not mergeable as is');
    expect(plan.body).not.toContain('### When it is done');
    expect(plan.body).toContain('**Purpose.**');
    // A docs-only exploration is Tier 1; a request the body already closes is not repeated.
    const docs = promotionPlan({ title: 'Exploration: copy', body: 'Closes #40', labels: [], files: [{ path: 'docs/AI.md', status: 'modified' }], requests: [40] });
    expect(docs.tier).toBe(1);
    expect(docs.addLabels).toEqual(['tier: 1']);
    expect(docs.body.match(/Closes #40/g)).toHaveLength(1);
  });

  it('labels the snapshot comment of an exploration and installs by name', () => {
    const body = previewComment({ owner: 'acme', repo: 'ds', pr: 12, branch: 'explore/pill-buttons', sha: SHA, packages: [{ name: '@bridge-ds/react', url: 'https://pkg.pr.new/acme/ds/@bridge-ds/react@0123456' }], source: 'pkg.pr.new', apps, exploration: true });
    expect(body).toContain('## Try this exploration in your product');
    expect(body).toContain('npm i @bridge-ds/react@https://pkg.pr.new/acme/ds/@bridge-ds/react@0123456');
    expect(body).toContain('never merged as is');
  });
});

describe('requests on an exploration', () => {
  const req: ComponentChangeRequest = { component: 'Button', kind: 'visual', title: 'Pill radius', summary: 'Try a pill radius.', changes: [], source: 'studio', exploration: 'explore/pill-buttons' };

  it('labels the issue and tells where to work', () => {
    const issue = composeRequestIssue(req);
    expect(issue.labels).toContain('exploration');
    expect(issue.body).toContain('**Exploration:** `explore/pill-buttons`');
    expect(issue.body).toContain('Commit the change to `explore/pill-buttons`');
    expect(parseRequestIssue(issue.body)?.exploration).toBe('explore/pill-buttons');
    expect(composeRequestIssue({ ...req, exploration: undefined }).labels).not.toContain('exploration');
  });

  it('brief: work on that branch, never a pull request to main', () => {
    const brief = requestBrief(req, { issue: 40 });
    expect(brief).toContain('Work on the existing branch explore/pill-buttons');
    expect(brief).toContain('Do not open a pull request to main');
    expect(brief).toContain('Refs #40');
    expect(brief).not.toContain('agent/request-40');
    // A target branch passed by the caller wins over the request's.
    expect(requestBrief({ ...req, exploration: undefined }, { issue: 40, exploration: 'explore/other' })).toContain('explore/other');
    expect(requestBrief({ ...req, exploration: undefined }, { issue: 40 })).toContain('agent/request-40');
  });
});

// --- GitHub helpers over a small in-memory GitHub ------------------------------------------------------------------

function fakeGitHub() {
  let n = 0;
  const refs = new Map<string, string>([['main', 'c0']]);
  const trees = new Map<string, Map<string, string>>([['c0', new Map([['README.md', 'hi']])]]);
  const pulls: any[] = [];
  const issues: any[] = [];
  const comments: { n: number; body: string }[] = [];
  const calls: { method: string; path: string; body?: any }[] = [];
  const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const f: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const path = url.replace('https://api.github.com', '').replace('/repos/acme/ds', '');
    calls.push({ method, path, body });
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const sha = refs.get(decodeURIComponent(m[1]!));
      return sha ? res(200, { object: { sha } }) : res(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(.+)$/.exec(path))) return res(200, { tree: { sha: m[1] } });
    if (method === 'POST' && path === '/git/trees') {
      const t = new Map(trees.get(body.base_tree));
      for (const e of body.tree) e.sha === null ? t.delete(e.path) : t.set(e.path, e.content);
      const id = `t${++n}`;
      trees.set(id, t);
      return res(201, { sha: id });
    }
    if (method === 'POST' && path === '/git/commits') {
      const id = `c${++n}`;
      trees.set(id, trees.get(body.tree)!);
      return res(201, { sha: id });
    }
    if (method === 'POST' && path === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (refs.has(name)) return res(422, { message: 'Reference already exists' });
      refs.set(name, body.sha);
      return res(201, {});
    }
    if (method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      refs.set(decodeURIComponent(m[1]!), body.sha);
      return res(200, {});
    }
    if (method === 'POST' && path === '/pulls') {
      const pr = { number: pulls.length + 1, node_id: `PR_${pulls.length + 1}`, title: body.title, body: body.body, state: 'open', draft: body.draft, user: { login: 'designer' }, head: { ref: body.head, sha: refs.get(body.head) }, base: { ref: body.base }, labels: [] as { name: string }[], html_url: `https://github.com/acme/ds/pull/${pulls.length + 1}`, updated_at: '2026-10-17T10:00:00Z' };
      pulls.push(pr);
      return res(201, pr);
    }
    if (method === 'GET' && path.startsWith('/pulls?')) {
      const q = new URLSearchParams(path.split('?')[1]);
      const head = q.get('head')?.split(':')[1];
      for (const p of pulls) p.head.sha = refs.get(p.head.ref) ?? p.head.sha;
      return res(200, pulls.filter((p) => (head ? p.head.ref === head && p.state === 'open' : q.get('state') === 'all' || p.state === q.get('state'))));
    }
    if ((m = /^\/pulls\/(\d+)$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      if (!pr) return res(404, {});
      if (method === 'PATCH') Object.assign(pr, body);
      pr.head.sha = refs.get(pr.head.ref) ?? pr.head.sha;
      return res(200, pr);
    }
    if (method === 'POST' && path === '/issues') {
      const issue = { number: 100 + issues.length, title: body.title, body: body.body, labels: (body.labels ?? []).map((name: string) => ({ name })), state: 'open', html_url: `https://github.com/acme/ds/issues/${100 + issues.length}`, user: { login: 'designer' }, created_at: '', updated_at: '' };
      issues.push(issue);
      return res(201, issue);
    }
    if (method === 'GET' && (m = /^\/pulls\/(\d+)\/files/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      const head = trees.get(refs.get(pr.head.ref)!)!;
      const base = trees.get(refs.get('main')!)!;
      return res(200, [...head.keys()].filter((k) => head.get(k) !== base.get(k)).map((filename) => ({ filename, status: base.has(filename) ? 'modified' : 'added', additions: 1, deletions: 0 })));
    }
    if (method === 'POST' && (m = /^\/issues\/(\d+)\/labels$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      for (const name of body.labels) if (!pr.labels.some((l: any) => l.name === name)) pr.labels.push({ name });
      return res(200, pr.labels);
    }
    if (method === 'DELETE' && (m = /^\/issues\/(\d+)\/labels\/(.+)$/.exec(path))) {
      const pr = pulls[Number(m[1]) - 1];
      pr.labels = pr.labels.filter((l: any) => l.name !== decodeURIComponent(m![2]!));
      return res(200, pr.labels);
    }
    if (method === 'GET' && (m = /^\/issues\/(\d+)\/comments/.exec(path))) return res(200, comments.filter((c) => c.n === Number(m![1])).map((c, i) => ({ id: i + 1, body: c.body, user: { login: 'github-actions[bot]' }, updated_at: '' })));
    if (method === 'POST' && path === '/graphql') {
      const pr = pulls.find((p) => p.node_id === body.variables.id);
      pr.draft = false;
      return res(200, { data: { markPullRequestReadyForReview: { pullRequest: { number: pr.number, isDraft: false } } } });
    }
    return res(404, { message: `no route ${method} ${path}` });
  };
  const noRetry = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };
  const client = (token = 't') => new GitHubClient('acme/ds', token, f, noRetry, { protectedBranches: ['main'], branchPrefix: 'bridge/' });
  return { client, refs, trees, pulls, issues, calls, comments };
}

describe('explorations on GitHub', () => {
  it('start: branch from main with the note, draft pull request labeled exploration, body with the install command', async () => {
    const gh = fakeGitHub();
    const s = await startExplorationOnGitHub(gh.client(), { name: 'Pill buttons', purpose: 'Rounder buttons in checkout.', author: 'designer' }, settings);
    expect(s).toMatchObject({ branch: 'explore/pill-buttons', slug: 'pill-buttons', pr: 1, url: 'https://github.com/acme/ds/pull/1' });
    expect(gh.trees.get(gh.refs.get('explore/pill-buttons')!)!.get('.bridge/explorations/pill-buttons.md')).toContain('# Exploration: Pill buttons');
    expect(gh.refs.get('main')).toBe('c0');
    const pr = gh.pulls[0];
    expect(pr.draft).toBe(true);
    expect(pr.base.ref).toBe('main');
    expect(pr.labels.map((l: any) => l.name)).toEqual(['exploration']);
    expect(pr.body).toContain('"Try this exploration in your product" comment');
    expect(pr.body).not.toContain('pkg.pr.new');
    // Just started: no command until the preview workflow posts it, never a guessed pkg.pr.new URL.
    expect(s.tryIt).toEqual({ state: 'building' });
    expect(JSON.stringify(s)).not.toContain('pkg.pr.new');
    expect(s.previews[0]!.url).toBe('https://bridge-docs-git-explore-pill-buttons-acme.vercel.app/');
    // Same name again: refused, nothing created.
    await expect(startExplorationOnGitHub(gh.client(), { name: 'Pill buttons', purpose: 'Again.' }, settings)).rejects.toThrow(/already exists/);
    await expect(startExplorationOnGitHub(gh.client(''), { name: 'Other', purpose: 'x' }, settings)).rejects.toThrow(/needs a GitHub token/);
    await expect(startExplorationOnGitHub(gh.client(), { name: '', purpose: '' }, settings)).rejects.toBeInstanceOf(GitHubError);
    expect(gh.pulls).toHaveLength(1);
  });

  it('start without a purpose: the commit message has none, the note and the body neither', async () => {
    const gh = fakeGitHub();
    await startExplorationOnGitHub(gh.client(), { name: 'Billing screen', purpose: '' }, settings);
    const commit = gh.calls.find((c) => c.method === 'POST' && c.path === '/git/commits')!;
    expect(commit.body.message).toBe('chore(explore): start Billing screen\n\nExploration: never merged as is. Promote it to review or close it.');
    expect(gh.pulls[0].body).not.toContain('**Purpose.**');
  });

  it('product repository access: its default branch, or not connected, or read only', async () => {
    const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() });
    const noRetry = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };
    const repo = (status: number, body: unknown) => new GitHubClient('acme/shop', 't', (async () => res(status, body)) as unknown as FetchLike, noRetry);
    expect(await productRepoAccess(repo(200, { full_name: 'acme/shop', default_branch: 'develop', private: true, permissions: { push: true } }))).toEqual({ ok: true, base: 'develop' });
    expect(await productRepoAccess(repo(200, { full_name: 'acme/shop', default_branch: 'main', private: true, permissions: { push: false, pull: true } }))).toEqual({ ok: false, reason: 'read-only' });
    expect(await productRepoAccess(repo(404, { message: 'Not Found' }))).toEqual({ ok: false, reason: 'not-connected' });
    expect(await productRepoAccess(repo(403, { message: 'Resource not accessible by integration' }))).toEqual({ ok: false, reason: 'not-connected' });
  });

  it('start with a Jira ticket: the key goes first in the pull request title', async () => {
    const gh = fakeGitHub();
    await startExplorationOnGitHub(gh.client(), { name: 'Pill buttons', purpose: 'Rounder buttons.', jira: 'DS-42' }, settings);
    expect(gh.pulls[0].title).toBe('DS-42 Exploration: Pill buttons');
  });

  it('start for a product: its label goes on the draft pull request with the exploration one', async () => {
    const gh = fakeGitHub();
    await startExplorationOnGitHub(gh.client(), { name: 'Billing screen', purpose: 'Overdue invoices.' }, { ...settings, labels: ['product: admin'] });
    expect(gh.pulls[0].labels.map((l: any) => l.name)).toEqual(['exploration', 'product: admin']);
  });

  it('labels: exploration on its own and retried, a refused product label never takes it with it, the rest reported', async () => {
    const calls: string[][] = [];
    let refuse = 2;
    const flaky = { addLabels: async (_n: number, ls: string[]) => (calls.push(ls), ls.includes('exploration') ? refuse-- <= 0 : false) };
    expect(await labelExploration(flaky, 7, ['product: shop'], 0)).toEqual(['product: shop']);
    expect(calls).toEqual([['exploration'], ['exploration'], ['exploration'], ['product: shop']]);
    const down = { addLabels: async () => false };
    expect(await labelExploration(down, 7, [], 0)).toEqual(['exploration']);
    const ok = { addLabels: async () => true };
    expect(await labelExploration(ok, 7, ['product: admin', 'exploration'], 0)).toEqual([]);
  });

  it('a running exploration whose label is missing still runs: open draft on explore/* or with the block', () => {
    const block = '<!-- bridge-exploration {"name":"create a scenario","slug":"create-a-scenario","source":"studio"} -->';
    const unlabeled = { state: 'open', draft: true, labels: [], headRef: 'explore/create-a-scenario', body: block };
    expect(isUnlabeledExploration(unlabeled)).toBe(true);
    expect(explorationStatus(unlabeled)).toBe('active');
    expect(isHeldExploration({ state: 'open', draft: true, labels: [], head: { ref: 'explore/create-a-scenario' } })).toBe(true);
    expect(isUnlabeledExploration({ ...unlabeled, headRef: 'bridge/x' })).toBe(true);
    expect(isUnlabeledExploration({ ...unlabeled, body: '' })).toBe(true);
    // Promoted the older way (ready for review), archived, done exploring, closed, or not an exploration: not running.
    expect(isUnlabeledExploration({ ...unlabeled, draft: false })).toBe(false);
    expect(explorationStatus({ ...unlabeled, draft: false })).toBe('promoted');
    expect(isUnlabeledExploration({ ...unlabeled, labels: ['archived'] })).toBe(false);
    expect(isUnlabeledExploration({ ...unlabeled, labels: ['ready-for-devs'] })).toBe(false);
    expect(isUnlabeledExploration({ ...unlabeled, state: 'closed' })).toBe(false);
    expect(isUnlabeledExploration({ state: 'open', draft: true, labels: [], headRef: 'bridge/x', body: 'plain draft' })).toBe(false);
    expect(isHeldExploration({ state: 'open', draft: true, labels: [], head: { ref: 'bridge/x' } })).toBe(false);
  });

  it('start for a request: the draft pull request lists the request it answers', async () => {
    const gh = fakeGitHub();
    await startExplorationOnGitHub(gh.client(), { name: 'Native select', purpose: 'Pages without React need one.' }, { ...settings, requests: [{ number: 81, title: 'Select: add a native Select' }] });
    expect(gh.pulls[0].body).toContain('Requests implemented here:\n- #81 Select: add a native Select');
  });

  it('list, promote (note removed, labels, ready for review via GraphQL) and close', async () => {
    const gh = fakeGitHub();
    const c = gh.client();
    await startExplorationOnGitHub(c, { name: 'Pill buttons', purpose: 'Rounder buttons.' }, settings);
    await startExplorationOnGitHub(c, { name: 'Dense tables', purpose: 'Compact rows.' }, settings);
    // A token edit committed to the exploration branch.
    await c.withBranchPrefix('explore/').commitToBranch({ branch: 'explore/pill-buttons', message: 'feat(tokens): pill', files: [{ path: 'packages/tokens/src/brands/bridge.tokens.json', content: '{}' }] });
    await expect(c.commitToBranch({ branch: 'main', message: 'x', files: [] })).rejects.toThrow(/protected branch/);

    const list = await listExplorationsOnGitHub(c, settings);
    expect(list.map((x) => [x.number, x.slug, x.status, x.name])).toEqual([
      [1, 'pill-buttons', 'active', 'Pill buttons'],
      [2, 'dense-tables', 'active', 'Dense tables'],
    ]);
    expect(list[0]!.purpose).toBe('Rounder buttons.');

    const dry = await promoteExplorationOnGitHub(c, 'pill-buttons', { dryRun: true, config: realConfig() });
    expect(dry.tier).toBe(3);
    expect(gh.pulls[0].labels.map((l: any) => l.name)).toEqual(['exploration']);

    const p = await promoteExplorationOnGitHub(c, 'Pill buttons', { config: realConfig(), requests: [40] });
    expect(p.warnings).toEqual([]);
    expect(p.addLabels).toEqual(['tier: 3', 'tokens']);
    const pr = gh.pulls[0];
    expect(pr.labels.map((l: any) => l.name)).toEqual(['tier: 3', 'tokens']);
    expect(pr.draft).toBe(false);
    expect(pr.title).toBe('Pill buttons');
    expect(pr.body).toContain('Closes #40');
    expect(gh.trees.get(gh.refs.get('explore/pill-buttons')!)!.has('.bridge/explorations/pill-buttons.md')).toBe(false);
    expect(gh.calls.some((x) => x.method === 'POST' && x.path === '/graphql' && x.body.query.includes('markPullRequestReadyForReview'))).toBe(true);
    await expect(promoteExplorationOnGitHub(c, 1)).rejects.toThrow(/already promoted/);
    expect((await listExplorationsOnGitHub(c, settings)).map((x) => x.status)).toEqual(['promoted', 'active']);

    const closed = await closeExplorationOnGitHub(c, '#2');
    expect(closed).toMatchObject({ number: 2, branch: 'explore/dense-tables' });
    expect(gh.pulls[1].state).toBe('closed');
    await expect(promoteExplorationOnGitHub(c, 2)).rejects.toThrow(/is closed/);
    await expect(promoteExplorationOnGitHub(c, 'nothing-here')).rejects.toThrow(/No open exploration/);
  });

  it('markReadyForReview reports GraphQL errors with what to do instead', async () => {
    const f: FetchLike = async (url) =>
      url.endsWith('/graphql')
        ? { ok: true, status: 200, json: async () => ({ errors: [{ message: 'Resource not accessible by personal access token' }] }), text: async () => '' }
        : { ok: true, status: 200, json: async () => ({ node_id: 'PR_1', draft: true }), text: async () => '' };
    const c = new GitHubClient('acme/ds', 't', f, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
    await expect(c.markReadyForReview(1)).rejects.toThrow(/Resource not accessible[\s\S]*Ready for review/);
    await expect(new GitHubClient('acme/ds', '', f).markReadyForReview(1)).rejects.toThrow(/needs a GitHub token/);
  });
});

// --- Try it: the install command comes from the sticky preview comment, never a guess -------------------------------

describe('exploration try it', () => {
  const tarballs = (sha: string) => ['tokens', 'react'].map((p) => ({ name: `@bridge-ds/${p}`, url: `https://github.com/acme/ds/releases/download/preview-pr-12/bridge-ds-${p}-${sha.slice(0, 7)}.tgz` }));
  const release = previewComment({ owner: 'acme', repo: 'ds', pr: 12, branch: 'explore/pill-buttons', sha: SHA, packages: tarballs(SHA), source: 'release', apps, exploration: true });
  const pkgPrNew = previewComment({ owner: 'acme', repo: 'ds', pr: 12, branch: 'explore/pill-buttons', sha: SHA, packages: [{ name: '@bridge-ds/react', url: `https://pkg.pr.new/acme/ds/@bridge-ds/react@${SHA}` }], source: 'pkg.pr.new', apps, exploration: true });
  const failed = previewComment({ owner: 'acme', repo: 'ds', pr: 12, branch: 'explore/pill-buttons', sha: SHA, packages: [], source: 'none', apps, exploration: true });

  it('reads the command of the first sh block: tarballs, pkg.pr.new, or none', () => {
    expect(installCommandFromPreviewComment(release)).toBe(`npm i ${tarballs(SHA).map((p) => `${p.name}@${p.url}`).join(' ')}`);
    expect(readPreviewComment(release)).toMatchObject({ sha7: '0123456', source: 'release' });
    expect(installCommandFromPreviewComment(pkgPrNew)).toBe(`npm i @bridge-ds/react@https://pkg.pr.new/acme/ds/@bridge-ds/react@${SHA}`);
    expect(readPreviewComment(pkgPrNew)?.source).toBe('pkg.pr.new');
    expect(installCommandFromPreviewComment(failed)).toBeNull();
    expect(readPreviewComment(failed)).toMatchObject({ command: null, source: 'none' });
    // Not the sticky comment: nothing, even with a sh block.
    expect(installCommandFromPreviewComment('```sh\nnpm i x\n```')).toBeNull();
    expect(installCommandFromPreviewComment(undefined)).toBeNull();
    // A command split over lines with backslashes reads as one line.
    expect(installCommandFromPreviewComment(`${PREVIEW_COMMENT_MARKER}\n\`\`\`sh\nnpm i a \\\n  b\n\`\`\``)).toBe('npm i a b');
    expect(findPreviewComment([{ body: 'hi' }, { body: release }, { body: 'DS Bridge added a commit' }])?.body).toBe(release);
  });

  it('ready only when the comment is about the head commit; building before; failed when the publish failed', () => {
    expect(explorationTryIt({ comment: release, headSha: SHA })).toMatchObject({ state: 'ready', source: 'release' });
    expect(explorationTryIt({ comment: undefined, headSha: SHA })).toEqual({ state: 'building' });
    expect(explorationTryIt({ comment: release, headSha: 'fedcba9876543210' })).toEqual({ state: 'building' });
    expect(explorationTryIt({ comment: failed, headSha: SHA })).toEqual({ state: 'failed' });
  });

  it('a share message with the working command, the previews and the pull request', () => {
    const msg = explorationShareMessage({ name: 'Pill buttons', branch: 'explore/pill-buttons', url: 'https://github.com/acme/ds/pull/12', command: 'npm i x@y', previews: [{ label: 'Admin demo', url: 'https://a/' }, { label: 'Library', url: 'https://d/' }] });
    expect(msg).toBe('Exploration "Pill buttons" (explore/pill-buttons): try it in a staging branch of your product with: npm i x@y. Previews: Admin demo https://a/, Library https://d/. Pull request: https://github.com/acme/ds/pull/12.');
    const building = explorationShareMessage({ name: 'Pill buttons', branch: 'explore/pill-buttons', url: 'https://github.com/acme/ds/pull/12' });
    expect(building).toMatch(/being prepared/);
    expect(building).not.toMatch(/npm|pkg\.pr\.new|Previews:/);
    expect(msg + building).not.toMatch(/\u2014/);
  });

  it('on GitHub: reads the comments and the branch head', async () => {
    const gh = fakeGitHub();
    const c = gh.client();
    const s = await startExplorationOnGitHub(c, { name: 'Pill buttons', purpose: 'Rounder buttons.' }, settings);
    expect(await explorationTryItOnGitHub(c, { number: s.pr, branch: s.branch })).toEqual({ state: 'building' });
    gh.refs.set(s.branch, SHA);
    gh.comments.push({ n: s.pr, body: previewComment({ owner: 'acme', repo: 'ds', pr: s.pr, branch: s.branch, sha: SHA, packages: tarballs(SHA), source: 'release', apps, exploration: true }) });
    expect(await explorationTryItOnGitHub(c, { number: s.pr, branch: s.branch })).toMatchObject({ state: 'ready', source: 'release' });
  });
});

describe('explorations in a product repository', () => {
  it('references name the repository: shop#12, owner/name#12, a link, shop:name; plain ones stay in the design system', async () => {
    const { parseExplorationRef, explorationRefLabel } = await import('../src/index');
    expect(parseExplorationRef(12)).toEqual({ ref: 12 });
    expect(parseExplorationRef('#12')).toEqual({ ref: 12 });
    expect(parseExplorationRef('pill-buttons')).toEqual({ ref: 'pill-buttons' });
    expect(parseExplorationRef('explore/pill-buttons')).toEqual({ ref: 'explore/pill-buttons' });
    expect(parseExplorationRef('Shop#12')).toEqual({ product: 'shop', ref: 12 });
    expect(parseExplorationRef('acme/shop#12')).toEqual({ repo: 'acme/shop', ref: 12 });
    expect(parseExplorationRef('https://github.com/acme/shop/pull/12/files')).toEqual({ repo: 'acme/shop', ref: 12 });
    expect(parseExplorationRef('shop:checkout-flow')).toEqual({ product: 'shop', ref: 'checkout-flow' });
    expect(explorationRefLabel({ number: 12 })).toBe('#12');
    expect(explorationRefLabel({ number: 12, product: 'shop', repo: 'acme/shop' })).toBe('shop#12');
  });

  it('lists each product repository once, tags its explorations, and skips one Bridge cannot read', async () => {
    const { listProductExplorationsOnGitHub } = await import('../src/index');
    const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() });
    const noRetry = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };
    const pull = { number: 3, title: 'Exploration: checkout', body: '', state: 'open', draft: true, user: { login: 'ann' }, head: { ref: 'explore/checkout', sha: 'a'.repeat(40) }, base: { ref: 'main' }, labels: [{ name: 'exploration' }], html_url: 'https://github.com/acme/shop/pull/3', updated_at: '2026-10-29T00:00:00Z' };
    const reads: string[] = [];
    const clientFor = (repo: string) =>
      new GitHubClient(
        repo,
        't',
        (async (url: string) => {
          reads.push(url);
          return repo === 'acme/shop' ? res(200, [pull, { ...pull, number: 4, head: { ref: 'feature/x', sha: 'b'.repeat(40) }, labels: [] }]) : res(404, { message: 'Not Found' });
        }) as unknown as FetchLike,
        noRetry,
      );
    const products = [
      { key: 'shop', name: 'Shop', repo: 'acme/shop', preview: 'https://shop-git-{branch}.vercel.app' },
      { key: 'gone', name: 'Gone', repo: 'acme/gone' },
      { key: 'admin', name: 'Admin demo', path: 'apps/admin' },
      { key: 'library', name: 'Library', default: true },
    ];
    const r = await listProductExplorationsOnGitHub(clientFor, products, 'acme/ds');
    expect(r.explorations).toHaveLength(1);
    expect(r.explorations[0]).toMatchObject({ number: 3, repo: 'acme/shop', product: 'shop', status: 'active', previews: [{ app: 'shop', label: 'Shop', url: 'https://shop-git-explore-checkout.vercel.app/' }] });
    expect(r.unreachable).toEqual([{ product: 'gone', name: 'Gone', repo: 'acme/gone', reason: 'not-connected' }]);
    expect(reads.filter((u) => u.includes('/pulls'))).toHaveLength(2);
  });

  it('a piece request names the product pull request across repositories', () => {
    const piece = { id: 'badge-overdue-tone', kind: 'variant' as const, name: 'overdue', title: 'Badge: overdue tone', summary: 'An overdue tone.', component: 'Badge', aspect: 'tone' as const, values: [{ category: 'color', property: 'background', value: '#fdecec' }], where: [] };
    const ref = { pr: 1, title: 'Billing', branch: 'explore/billing', url: 'https://github.com/acme/shop/pull/1', productKey: 'shop', productName: 'Shop', repo: 'acme/shop' };
    const r = pieceRequest(piece, ref, { previewUrl: 'https://shop.example/preview' });
    expect(r.request.summary).toContain('Shop needs it for "Billing" (acme/shop#1)');
    expect(r.neededBy).toMatchObject({ pr: 1, repo: 'acme/shop' });
    const same = pieceRequest(piece, { ...ref, repo: undefined });
    expect(same.request.summary).toContain('(#1)');
  });
});
