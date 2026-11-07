// Notifications, phase 1 (api/_lib/notify*.ts): the pure mapper per event, who a notice is for (an email member found,
// nobody found, a designer signed in with GitHub), right away at most once per thing per hour, the daily summary (never
// empty), the sealed unsubscribe token, the choices, the time zone hour and the Brevo sender.
import { describe, expect, it } from 'vitest';
import { putAccount, type Account } from '../../api/_lib/account';
import { brevoSender, parseSender, type EmailMessage, type EmailSender } from '../../api/_lib/email';
import { issueKey } from '../../api/_lib/former-member';
import { memberStore } from '../../api/_lib/members';
import { cleanTitle, closedIssues, DESIGN_REVIEW_PREFIX, leadNoticesOf, linkedCopy, NEEDS_DESIGN_LABEL, notifyEventsOf, QUOTE_MAX, quoteOf, TASK_BACK_PREFIX, type Notice } from '../../api/_lib/notify-events';
import { DESIGN_TASK_BACK_COMMENT } from '@bridge-ds/core';
import { DESIGN_REVIEW_PREFIX as STUDIO_REVIEW_PREFIX, NEEDS_DESIGN_LABEL as STUDIO_NEEDS_DESIGN } from './review-state';
import { digestEmail, digestSubject, instantEmail, linesOf, readUnsubToken, unsubToken, type NotifyItem } from '../../api/_lib/notify-mail';
import {
  deliverNotices,
  digestKey,
  DUE_KEY,
  hrefOf,
  itemWrite,
  nextDigestAt,
  type NotifyDeps,
  notifySenderFromEnv,
  parsePrefs,
  prefsOf,
  resetNotifyWarning,
  REMIND_KEY,
  sendDueDigests,
  sendReminders,
  validTimeZone,
  waitingKey,
  watchWrites,
} from '../../api/_lib/notify';
import { memoryRedis } from '../../api/_lib/redis';
import { profileNameOf, userKey } from '../../api/_lib/team-read';

const SECRET = 's'.repeat(40);
const T0 = Date.parse('2026-11-02T10:00:00Z');
const TEAM = 'acme/design';
const CODE = 'acme/shop';
const COPY = 'acme/shop-design';
const MIA = 'mia@acme.design';
const dev = { login: 'ana', id: 42, type: 'User' };
const bot = { login: 'bridge-app[bot]', id: 9, type: 'Bot' };
const taskBody = `The design team explored this in Bridge.\n\n**Preview.** In the Vercel comment of the prototype: https://github.com/${COPY}/pull/7`;

describe('notifyEventsOf, the mapper', () => {
  const repo = { full_name: 'Acme/Shop' };
  it('a developer comment on a task: a question, the exploration it links kept', () => {
    const n = notifyEventsOf('issue_comment', { action: 'created', repository: repo, sender: dev, issue: { number: 12, title: 'Design: Pill buttons', body: taskBody }, comment: { user: dev, body: 'Which radius?' } });
    expect(n).toEqual([{ kind: 'question', repo: CODE, items: [12], title: 'Pill buttons', actor: { login: 'ana', id: 42 }, copy: { repo: COPY, number: 7 }, scope: 'any', quote: 'Which radius?' }]);
  });
  it('quotes what was written: plain text, the start of it, cut on a word', () => {
    expect(quoteOf('<!-- bot -->Which radius?\r\n\r\n\r\n![shot](https://x/y.png) <b>here</b>')).toBe('Which radius?\n\n(image) here');
    expect(quoteOf('Pill \u2014 or square?')).toBe('Pill, or square?');
    const long = quoteOf('word '.repeat(200));
    expect(long.length).toBeLessThanOrEqual(QUOTE_MAX + 1);
    expect(long.endsWith('word…')).toBe(true);
    expect(quoteOf('  ')).toBe('');
    expect(quoteOf(undefined)).toBe('');
  });
  it('never a comment Bridge posted for the designer, nor one by a bot, nor one on a pull request', () => {
    const base = { action: 'created', repository: repo, issue: { number: 12, title: 'X' } };
    expect(notifyEventsOf('issue_comment', { ...base, sender: bot, comment: { user: bot, body: '**Mia** (via Bridge):\n\nThanks' } })).toEqual([]);
    expect(notifyEventsOf('issue_comment', { ...base, sender: dev, comment: { user: dev, body: '**Mia** (via Bridge):\n\nThanks' } })).toEqual([]);
    expect(notifyEventsOf('issue_comment', { ...base, sender: { login: 'vercel[bot]', type: 'Bot' }, comment: { user: { login: 'vercel[bot]', type: 'Bot' }, body: 'Deployed' } })).toEqual([]);
    expect(notifyEventsOf('issue_comment', { ...base, issue: { number: 3, pull_request: {} }, sender: dev, comment: { user: dev, body: 'Hm' } })).toEqual([]);
  });
  it('the same rule as Studio (devQuestionOf): needs-design asks too; a closed task, a design review or taking it back never asks', () => {
    expect(notifyEventsOf('issues', { action: 'labeled', repository: repo, sender: dev, label: { name: 'needs-design' }, issue: { number: 12, title: 'Design: Pill buttons', body: taskBody } })).toMatchObject([{ kind: 'question', items: [12], actor: { login: 'ana' } }]);
    expect(notifyEventsOf('issues', { action: 'labeled', repository: repo, sender: dev, label: { name: 'bug' }, issue: { number: 12, title: 'X' } })).toEqual([]);
    const say = (body: string, state = 'open') => notifyEventsOf('issue_comment', { action: 'created', repository: repo, sender: dev, issue: { number: 12, title: 'X', state }, comment: { user: dev, body } });
    expect(say('Which radius?', 'closed')).toEqual([]);
    expect(say(`${DESIGN_REVIEW_PREFIX} looks right`)).toEqual([]);
    expect(say(DESIGN_TASK_BACK_COMMENT)).toEqual([]);
    expect(NEEDS_DESIGN_LABEL).toBe(STUDIO_NEEDS_DESIGN);
    expect(DESIGN_REVIEW_PREFIX).toBe(STUDIO_REVIEW_PREFIX);
    expect(DESIGN_TASK_BACK_COMMENT.startsWith(TASK_BACK_PREFIX)).toBe(true);
  });
  it('a task closed as not planned by a developer: declined; closed as done: shipped; closed by Bridge for the designer: nothing', () => {
    const closed = (state_reason: string, sender: unknown) => notifyEventsOf('issues', { action: 'closed', repository: repo, sender, issue: { number: 12, title: 'Design: Pill buttons', state_reason, body: taskBody } });
    expect(closed('not_planned', dev)).toMatchObject([{ kind: 'declined', items: [12], copy: { repo: COPY, number: 7 } }]);
    expect(closed('completed', dev)).toMatchObject([{ kind: 'shipped', items: [12] }]);
    expect(closed('not_planned', bot)).toEqual([]);
  });
  it("the developers' version ready for a look: opened ready or marked ready, closing a task; never a draft", () => {
    const pr = (action: string, draft: boolean, body = 'Closes #12') => notifyEventsOf('pull_request', { action, repository: repo, sender: dev, pull_request: { number: 30, title: 'Pill buttons', draft, body, user: dev } });
    expect(pr('opened', false)).toEqual([{ kind: 'look', repo: CODE, items: [12], title: 'Pill buttons', actor: { login: 'ana', id: 42 }, copy: null, scope: 'any' }]);
    expect(pr('ready_for_review', false)).toMatchObject([{ kind: 'look' }]);
    expect(pr('opened', true)).toEqual([]);
    expect(pr('opened', false, 'No link')).toEqual([]);
  });
  it('merged, closing a task: shipped; a suggestion closed unmerged by a lead: suggestion-declined (library only)', () => {
    expect(notifyEventsOf('pull_request', { action: 'closed', repository: repo, sender: dev, pull_request: { number: 30, merged: true, title: 'X', body: 'Fixes #12', user: dev } })).toMatchObject([{ kind: 'shipped', items: [12] }]);
    expect(notifyEventsOf('pull_request', { action: 'closed', repository: { full_name: TEAM }, sender: dev, pull_request: { number: 5, merged: false, title: 'Badge: overdue tone', user: bot } })).toEqual([
      { kind: 'suggestion-declined', repo: TEAM, items: [5], title: 'Badge: overdue tone', actor: { login: 'ana', id: 42 }, copy: null, scope: 'library' },
    ]);
    expect(notifyEventsOf('pull_request', { action: 'closed', repository: { full_name: TEAM }, sender: bot, pull_request: { number: 5, merged: false, title: 'X', user: bot } })).toEqual([]);
  });
  it('changes requested on a suggestion; an approval or a comment review is not phase 1', () => {
    const review = (state: string) => notifyEventsOf('pull_request_review', { action: 'submitted', repository: { full_name: TEAM }, sender: dev, pull_request: { number: 5, title: 'Badge: overdue tone' }, review: { state, user: dev } });
    expect(review('changes_requested')).toMatchObject([{ kind: 'changes', items: [5], scope: 'library' }]);
    const noted = notifyEventsOf('pull_request_review', { action: 'submitted', repository: { full_name: TEAM }, sender: dev, pull_request: { number: 5, title: 'x' }, review: { state: 'changes_requested', user: dev, body: 'Use the 8px radius.' } });
    expect(noted).toMatchObject([{ kind: 'changes', quote: 'Use the 8px radius.' }]);
    expect(review('changes_requested')[0]).not.toHaveProperty('quote');
    expect(review('approved')).toEqual([]);
    expect(review('commented')).toEqual([]);
  });
  it('anything else, or a payload without a repository: nothing', () => {
    expect(notifyEventsOf('push', { repository: repo })).toEqual([]);
    expect(notifyEventsOf('issues', { action: 'closed', issue: { number: 1 } })).toEqual([]);
    expect(notifyEventsOf('issues', null)).toEqual([]);
  });
  it('titles in the designer words, closing keywords, the linked exploration', () => {
    expect(cleanTitle('Design: Pill buttons')).toBe('Pill buttons');
    // As Studio names it: a capital first, no conventional prefix.
    expect(cleanTitle('Design: add a toast alert')).toBe('Add a toast alert');
    expect(cleanTitle('add a toast alert')).toBe('Add a toast alert');
    expect(cleanTitle('feat(toast): add a toast alert')).toBe('Add a toast alert');
    expect(cleanTitle('Badge \u2014 overdue')).toBe('Badge, overdue');
    expect(closedIssues('Closes #12, fixes #3 and resolves https://github.com/acme/shop/issues/7. See #9.', CODE)).toEqual([12, 3, 7]);
    expect(linkedCopy(taskBody, CODE)).toEqual({ repo: COPY, number: 7 });
    expect(linkedCopy(`https://github.com/${CODE}/pull/2`, CODE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------

function world(o: { sender?: EmailSender | null } = {}) {
  let now = T0;
  const redis = memoryRedis(() => now);
  const sent: EmailMessage[] = [];
  const sender: EmailSender | null = o.sender === undefined ? { send: async (m) => void sent.push(m) } : o.sender;
  const warnings: string[] = [];
  const d: NotifyDeps = { redis, sender, secret: SECRET, origin: 'https://bridge.example.com', now: () => now, warn: (m) => warnings.push(m), random: (n) => new Uint8Array(n).fill(1) };
  const watch = async () =>
    redis.pipe([
      ...watchWrites([
        { repo: TEAM, meta: { team: TEAM, kind: 'team' } },
        { repo: COPY, meta: { team: TEAM, kind: 'copy', product: 'shop' } },
        { repo: CODE, meta: { team: TEAM, kind: 'code', product: 'shop' } },
      ]),
    ]);
  const member = async (email = MIA) => memberStore(redis).put(TEAM, { email, name: 'Mia', role: 'edit', version: 1, addedBy: 'dana', at: new Date(now).toISOString() });
  const account = async (patch: Partial<Account> = {}) => putAccount(redis, { id: 'a1', email: MIA, name: 'Mia', github: null, createdAt: '', version: 1, ...patch });
  const task = async (owner = MIA, n = 12) => redis.pipe([['SET', issueKey(CODE, n), owner], itemWrite(CODE, n, { title: 'Pill buttons', copy: { repo: COPY, number: 7 } })]);
  return { redis, d, sent, warnings, watch, member, account, task, tick: (ms: number) => (now += ms), at: () => now };
}

const question: Notice = { kind: 'question', repo: CODE, items: [12], title: 'Design: other', actor: { login: 'ana', id: 42 }, copy: null, scope: 'any' };

describe('who a notice is for', () => {
  it('the email member Bridge keeps as the author of the task: sent right away, to the exploration page', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task();
    expect(await deliverNotices([question], w.d, 'd1')).toEqual([{ kind: 'question', status: 'sent' }]);
    expect(w.sent).toHaveLength(1);
    const m = w.sent[0]!;
    expect(m.to).toBe(MIA);
    expect(m.subject).toBe('ana has a question about Pill buttons');
    expect(m.text).toContain('https://bridge.example.com/studio/~/acme/design/changes/?exploration=7&product=shop');
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(m.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/bridge\.example\.com\/api\/account\?unsub=[A-Za-z0-9_.-]+>$/);
    // No tech word, no em dash, never the address in a link.
    expect(`${m.subject} ${m.text}`).not.toMatch(/\u2014|\bissue\b|pull request|\brepo|webhook|\bPR\b/i);
    expect(m.text).not.toContain(encodeURIComponent(MIA));
  });
  it('names the developer by their Bridge name when their GitHub is linked to an account', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task();
    await putAccount(w.redis, { id: 'b', email: 'ana@acme.dev', name: 'Ana Ruiz', github: { login: 'ana', id: 42 }, createdAt: '', version: 1 });
    await w.redis.cmd('SET', 'bridge:account:gh:42', 'ana@acme.dev');
    await deliverNotices([question], w.d, 'd1');
    expect(w.sent[0]!.subject).toBe('Ana Ruiz has a question about Pill buttons');
  });
  it('else by their GitHub profile name, as Studio names them; the login only when they set none', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task(MIA, 12);
    await w.task(MIA, 13);
    const asked: string[] = [];
    w.d.profileName = async (login, repo) => (asked.push(`${login}@${repo}`), login === 'peterbono' ? 'Florian' : null);
    await deliverNotices([{ ...question, actor: { login: 'peterbono', id: 7 } }], w.d, 'd1');
    expect(w.sent[0]!.subject).toBe('Florian has a question about Pill buttons');
    expect(w.sent[0]!.text).toContain('Answer Florian:');
    expect(asked).toEqual([`peterbono@${CODE}`]);
    await deliverNotices([{ ...question, items: [13], actor: { login: 'nobody', id: 8 } }], w.d, 'd2');
    expect(w.sent[1]!.subject).toBe('nobody has a question about Pill buttons');
  });
  it('a title kept in lower case reads as Studio names it', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.redis.pipe([['SET', issueKey(CODE, 12), MIA], itemWrite(CODE, 12, { title: 'add a toast alert', copy: { repo: COPY, number: 7 } })]);
    await deliverNotices([question], w.d, 'd1');
    expect(w.sent[0]!.subject).toBe('ana has a question about Add a toast alert');
  });
  it('quotes the question in the email, never in the summary', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task();
    await deliverNotices([{ ...question, quote: 'Which <radius> do you want?' }], w.d, 'd1');
    const m = w.sent[0]!;
    expect(m.text).toContain('> Which <radius> do you want?');
    expect(m.html).toContain('Which &lt;radius&gt; do you want?');
    expect(m.html).not.toContain('<radius>');
    // Within the hour: it folds into the summary, without the words.
    await deliverNotices([{ ...question, quote: 'And the color?' }], w.d, 'd2');
    expect(JSON.stringify(await w.redis.cmd('ZRANGE', digestKey(MIA), 0, -1))).not.toContain('color');
  });
  it('a task Bridge kept no author for: the author of the exploration it links', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.redis.cmd('SET', issueKey(COPY, 7), MIA);
    expect(await deliverNotices([{ ...question, copy: { repo: COPY, number: 7 } }], w.d, 'd1')).toEqual([{ kind: 'question', status: 'sent' }]);
  });
  it('nobody found, an unwatched repository, a designer signed in with GitHub, someone no longer on the team: nothing', async () => {
    const w = world();
    expect(await deliverNotices([question], w.d, 'd0')).toEqual([{ kind: 'question', status: 'skipped', reason: 'unwatched' }]);
    await w.watch();
    expect(await deliverNotices([question], w.d, 'd1')).toEqual([{ kind: 'question', status: 'skipped', reason: 'no-owner' }]);
    await w.task('gh:mia-gh');
    expect(await deliverNotices([question], w.d, 'd2')).toEqual([{ kind: 'question', status: 'skipped', reason: 'github' }]);
    await w.task(MIA);
    expect(await deliverNotices([question], w.d, 'd3')).toEqual([{ kind: 'question', status: 'skipped', reason: 'not-member' }]);
    expect(w.sent).toEqual([]);
  });
  it('a suggestion notice only in the team library, never in a product', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.redis.cmd('SET', issueKey(TEAM, 5), MIA);
    const changes: Notice = { kind: 'changes', repo: TEAM, items: [5], title: 'Badge: overdue tone', actor: { login: 'dana', id: null }, copy: null, scope: 'library' };
    expect(await deliverNotices([{ ...changes, repo: COPY }], w.d, 'd1')).toEqual([{ kind: 'changes', status: 'skipped', reason: 'not-library' }]);
    expect(await deliverNotices([changes], w.d, 'd2')).toEqual([{ kind: 'changes', status: 'sent' }]);
    expect(w.sent[0]!.subject).toBe('dana asked for changes on Badge: overdue tone');
    expect(w.sent[0]!.text).toContain('/studio/~/acme/design/changes/?pr=5');
  });
});

describe('right away, at most once per thing per hour', () => {
  it('a send the provider refused does not use up the hour: the next event tries again', async () => {
    let fail = true;
    const sent: unknown[] = [];
    const w = world({ sender: { send: async (m) => { if (fail) throw new Error('email provider answered 401 unauthorized'); sent.push(m); } } });
    await w.watch();
    await w.member();
    await w.task();
    expect(await deliverNotices([question], w.d, 'd1')).toEqual([{ kind: 'question', status: 'kept', reason: 'not-sent email provider answered 401 unauthorized' }]);
    fail = false;
    expect(await deliverNotices([question], w.d, 'd2')).toEqual([{ kind: 'question', status: 'sent' }]);
    expect(sent).toHaveLength(1);
  });
  it('a second question within the hour folds into the summary; after the hour, right away again', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task();
    expect(await deliverNotices([question], w.d, 'd1')).toEqual([{ kind: 'question', status: 'sent' }]);
    expect(await deliverNotices([question], w.d, 'd2')).toEqual([{ kind: 'question', status: 'kept', reason: 'within-the-hour' }]);
    expect(await w.redis.cmd('ZRANGE', digestKey(MIA), 0, -1)).toHaveLength(1);
    w.tick(61 * 60 * 1000);
    expect(await deliverNotices([question], w.d, 'd3')).toEqual([{ kind: 'question', status: 'sent' }]);
    expect(w.sent).toHaveLength(2);
  });
  it('news goes in the summary, said once per thing; "Never" keeps nothing', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task();
    const shipped: Notice = { ...question, kind: 'shipped' };
    expect(await deliverNotices([shipped], w.d, 'd1')).toEqual([{ kind: 'shipped', status: 'kept' }]);
    expect(await deliverNotices([shipped], w.d, 'd2')).toEqual([{ kind: 'shipped', status: 'skipped', reason: 'repeat' }]);
    await w.account({ notify: { needs: 'off', news: 'daily' } });
    expect(await deliverNotices([question], w.d, 'd3')).toEqual([{ kind: 'question', status: 'skipped', reason: 'off' }]);
    expect(w.sent).toEqual([]);
  });
  it('"In the daily summary" keeps what needs them for 09:00 in their time zone', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task();
    await w.account({ notify: { needs: 'daily', news: 'daily' }, tz: 'America/New_York' });
    expect(await deliverNotices([question], w.d, 'd1')).toEqual([{ kind: 'question', status: 'kept' }]);
    expect(Number(await w.redis.cmd('ZSCORE', DUE_KEY, MIA))).toBe(Date.parse('2026-11-02T14:00:00Z'));
  });
  it('without BREVO_API_KEY: kept, not sent, said once', async () => {
    resetNotifyWarning();
    const w = world({ sender: null });
    await w.watch();
    await w.member();
    await w.task();
    expect(await deliverNotices([question], w.d, 'd1')).toEqual([{ kind: 'question', status: 'kept', reason: 'no-sender' }]);
    await deliverNotices([{ ...question, items: [12] }], w.d, 'd2');
    expect(w.warnings).toEqual(['notifications: BREVO_API_KEY is not set, notifications are kept but not sent']);
    expect(w.warnings.join(' ')).not.toContain('@');
  });
});

describe('the daily summary', () => {
  it('sends what is due once, "Needs you" first, and never an empty one', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task();
    await deliverNotices([question], w.d, 'd1');
    await deliverNotices([question, { ...question, kind: 'shipped' }], w.d, 'd2');
    // Not due yet (10:00 UTC is 11:00 in Paris: due tomorrow at 09:00).
    expect(await sendDueDigests(w.d)).toEqual({ sent: 0, empty: 0, later: 0 });
    w.tick(24 * 60 * 60 * 1000);
    expect(await sendDueDigests(w.d)).toEqual({ sent: 1, empty: 0, later: 0 });
    const m = w.sent[1]!;
    expect(m.subject).toBe('Today on Design: 1 thing needs you, 1 thing moved');
    expect(m.text.indexOf('Needs you')).toBeLessThan(m.text.indexOf('What moved'));
    expect(m.text).toContain('Pill buttons shipped');
    // Said: nothing left, nothing due, nothing sent again.
    expect(await w.redis.cmd('ZRANGE', digestKey(MIA), 0, -1)).toEqual([]);
    expect(await sendDueDigests(w.d)).toEqual({ sent: 0, empty: 0, later: 0 });
    expect(w.sent).toHaveLength(2);
  });
  it('a summary whose items were all turned off since: nothing sent', async () => {
    const w = world();
    await w.watch();
    await w.member();
    await w.task();
    await deliverNotices([{ ...question, kind: 'shipped' }], w.d, 'd1');
    await w.account({ notify: { needs: 'soon', news: 'off' } });
    w.tick(24 * 60 * 60 * 1000);
    expect(await sendDueDigests(w.d)).toEqual({ sent: 0, empty: 1, later: 0 });
    expect(w.sent).toEqual([]);
  });
  it('digestEmail: null when empty; the subject counts', () => {
    expect(digestEmail([], { to: MIA, settings: 's', unsubscribe: 'u', home: 'h' })).toBeNull();
    expect(digestSubject('Acme', 0, 3)).toBe('3 things moved on Acme');
    expect(digestSubject('Acme', 2, 0)).toBe('Today on Acme: 2 things need you');
    expect(digestSubject('Acme', 2, 3)).toBe('Today on Acme: 2 things need you, 3 things moved');
  });
});

describe('the emails', () => {
  const item = (kind: NotifyItem['kind']): NotifyItem => ({ id: 'x', kind, title: 'Pill buttons', actor: 'Ana', team: 'Acme', teamRepo: TEAM, href: 'https://b/x', at: T0 });
  it('one sentence and one button per kind, in Bridge words', () => {
    for (const k of ['question', 'look', 'changes', 'declined', 'shipped', 'suggestion-declined'] as const) {
      const l = linesOf(item(k));
      expect(`${l.subject} ${l.sentence} ${l.button}`).not.toMatch(/\u2014|\bissue\b|pull request|\brepo|webhook|merge|\bPR\b/i);
    }
    expect(linesOf(item('look')).subject).toBe('Pill buttons is ready for your look');
    const m = instantEmail(item('shipped'), { to: MIA, settings: 'https://b/#account', unsubscribe: 'https://b/u' });
    expect(m.html).toContain('<html lang="en">');
    // One shell for every Bridge email: a preheader, layout tables, a bulletproof button, dark mail apps.
    expect(m.html).toContain('role="presentation"');
    expect(m.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(m.html).toContain('prefers-color-scheme: dark');
    expect(m.html).toMatch(/<td class="b-btn" bgcolor="#0B4A8B"/);
    expect(m.html).toContain('What you designed is now in the product. Nice work.&#847;');
    const q = instantEmail({ ...item('changes'), quote: 'Use the 8px radius.\nAnd a lighter border.' }, { to: MIA, settings: 'https://b/#account', unsubscribe: 'https://b/u' });
    expect(q.text).toContain('> Use the 8px radius.\n> And a lighter border.');
    expect(q.html).toContain('Use the 8px radius.<br>And a lighter border.');
    expect(q.text).toContain("See Ana's notes: https://b/x");
    expect(m.html).toContain('Change what Bridge emails you');
    expect(m.text).toContain('Stop these emails: https://b/u');
  });
  it('links: the exploration of a task, the change of a suggestion, else Being built', () => {
    expect(hrefOf('https://b', TEAM, 'look', 12, { repo: COPY, number: 7 }, 'shop')).toBe('https://b/studio/~/acme/design/changes/?exploration=7&product=shop');
    expect(hrefOf('https://b', TEAM, 'changes', 5, null, undefined)).toBe('https://b/studio/~/acme/design/changes/?pr=5');
    expect(hrefOf('https://b', TEAM, 'shipped', 12, null, undefined)).toBe('https://b/studio/~/acme/design/building/');
  });
});

describe('unsubscribe tokens', () => {
  it('open with the secret only, untouched', () => {
    const t = unsubToken(SECRET, 'Mia@Acme.design', 'needs')!;
    expect(t).not.toContain('mia');
    expect(readUnsubToken(SECRET, t)).toEqual({ email: MIA, kind: 'needs' });
    expect(readUnsubToken('x'.repeat(40), t)).toBeNull();
    const [a, b, c] = t.split('.');
    expect(readUnsubToken(SECRET, `${a}.${b}.${c!.slice(0, -2)}AA`)).toBeNull();
    expect(readUnsubToken(SECRET, 'nope')).toBeNull();
    expect(unsubToken('short', MIA, 'all')).toBeNull();
  });
});

describe('choices and time zone', () => {
  it('defaults right away and daily; only the choices offered', () => {
    expect(prefsOf(null)).toEqual({ needs: 'soon', news: 'daily' });
    expect(prefsOf({ notify: { needs: 'off', news: 'off' } })).toEqual({ needs: 'off', news: 'off' });
    expect(parsePrefs({ needs: 'daily' }, prefsOf(null))).toEqual({ needs: 'daily', news: 'daily' });
    expect(parsePrefs({ news: 'soon' }, prefsOf(null))).toBeNull();
    expect(parsePrefs({ needs: 'sometimes' }, prefsOf(null))).toBeNull();
  });
  it('09:00 in the person time zone, next one strictly after now', () => {
    expect(new Date(nextDigestAt(Date.parse('2026-11-02T07:00:00Z'), 'Europe/Paris')).toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(new Date(nextDigestAt(Date.parse('2026-11-02T08:00:00Z'), 'Europe/Paris')).toISOString()).toBe('2026-11-03T08:00:00.000Z');
    expect(new Date(nextDigestAt(Date.parse('2026-07-01T12:00:00Z'), 'Europe/Paris')).toISOString()).toBe('2026-07-02T07:00:00.000Z');
    expect(new Date(nextDigestAt(Date.parse('2026-11-02T00:30:00Z'), 'Asia/Manila')).toISOString()).toBe('2026-11-02T01:00:00.000Z');
    expect(validTimeZone('Europe/Paris')).toBe('Europe/Paris');
    expect(validTimeZone('Mars/Olympus')).toBeNull();
    expect(validTimeZone('<script>')).toBeNull();
  });
});

describe('profileNameOf, the name Studio shows for a GitHub person', () => {
  it("Studio's kept profile first; else one GitHub read with the team's read token, kept; null without a name", async () => {
    const redis = memoryRedis(() => T0);
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${(init?.headers as Record<string, string>)?.Authorization}`);
      return new Response(JSON.stringify({ login: 'peterbono', name: 'Florian', type: 'User' }), { status: 200 });
    }) as unknown as typeof fetch;
    const ctx = { f, now: () => T0, redis, token: async () => 'tok' };
    await redis.cmd('SET', userKey('ana'), JSON.stringify({ login: 'ana', name: 'Ana Ruiz', avatar_url: null, type: 'User' }));
    expect(await profileNameOf(ctx, 'acme', 'shop', 'ana')).toBe('Ana Ruiz');
    expect(calls).toEqual([]);
    expect(await profileNameOf(ctx, 'acme', 'shop', 'peterbono')).toBe('Florian');
    expect(calls).toEqual(['https://api.github.com/users/peterbono Bearer tok']);
    expect(await profileNameOf(ctx, 'acme', 'shop', 'peterbono')).toBe('Florian');
    expect(calls).toHaveLength(1);
    expect(await profileNameOf({ ...ctx, token: async () => null }, 'acme', 'shop', 'someone')).toBeNull();
  });
});

describe('the Brevo sender', () => {
  it('posts the transactional email with the api-key header and the unsubscribe headers', async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
    const s = brevoSender('xkeysib-test', 'Bridge <notifications@acme.com>', async (url, init) => {
      calls.push({ url, init });
      return new Response('{"messageId":"1"}', { status: 201 });
    });
    await s.send({ to: MIA, subject: 'S', text: 'T', html: '<p>H</p>', headers: { 'List-Unsubscribe': '<https://b/u>' } });
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0]!.init.headers['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({
      sender: { name: 'Bridge', email: 'notifications@acme.com' },
      to: [{ email: MIA }],
      subject: 'S',
      textContent: 'T',
      htmlContent: '<p>H</p>',
      headers: { 'List-Unsubscribe': '<https://b/u>' },
    });
  });
  it('throws on a refusal without the key or the address in the message', async () => {
    const s = brevoSender('xkeysib-test', 'notifications@acme.com', async () => new Response('{}', { status: 401 }));
    await expect(s.send({ to: MIA, subject: 'S', text: 'T', html: 'H' })).rejects.toThrow('email provider answered 401');
    await expect(brevoSender('k', 'not an address', async () => new Response()).send({ to: MIA, subject: 'S', text: 'T', html: 'H' })).rejects.toThrow(/not valid/);
  });
  it('from the env: needs the key; NOTIFY_FROM else INVITE_EMAIL_FROM', () => {
    const f = async () => new Response();
    expect(notifySenderFromEnv({ NOTIFY_FROM: 'a@b.co' }, f)).toBeNull();
    expect(notifySenderFromEnv({ BREVO_API_KEY: 'k', INVITE_EMAIL_FROM: 'Bridge <a@b.co>' }, f)).not.toBeNull();
    expect(parseSender('Bridge <notifications@floriangouloubi.com>')).toEqual({ name: 'Bridge', email: 'notifications@floriangouloubi.com' });
    expect(parseSender('notifications@floriangouloubi.com')).toEqual({ name: 'Bridge', email: 'notifications@floriangouloubi.com' });
    expect(parseSender('nobody')).toBeNull();
  });
});

describe('the talk with a design lead', () => {
  const block = (e: Record<string, unknown>) => `body\n<!-- bridge-exploration ${JSON.stringify({ name: 'Late tag', purpose: '', slug: 'late-tag', ...e })} -->`;
  const base = { repo: COPY, number: 7 };
  const said = (kind: string, more: Record<string, unknown> = {}) => ({ kind, at: 't', round: 1, by: 'flo', byName: 'Florian', ...more });
  const none = block({});

  it('Done exploring tells the leads asked, and a reminder starts', () => {
    const n = leadNoticesOf(none, block({ leadAskedAt: 't', leadAskedByName: 'Mia', leadAskedTo: ['flo', 'dana'] }), base);
    expect(n).toMatchObject([{ kind: 'lead-ask', to: ['flo', 'dana'], actorName: 'Mia', title: 'Late tag', items: [7], waits: true }]);
  });
  it.each([
    ['question', 'lead-question', 'Which tab?'],
    ['changes', 'lead-changes', 'Tighter'],
    ['take-back', 'lead-took-back', 'The date hides'],
    ['not-doing', 'lead-not-doing', 'Billing covers it'],
    ['looks-right', 'lead-ok', 'Mind the tag'],
    ['handed', 'lead-handed', 'On leave'],
  ])('%s: for the keeper, quoting them, and the wait ends', (kind, notice, text) => {
    const n = leadNoticesOf(none, block({ decisions: [said(kind, { text })] }), base);
    expect(n).toMatchObject([{ kind: notice, actorName: 'Florian', quote: text, stops: true }]);
    expect(n[0]!.to).toBeUndefined();
  });
  it('the answer goes to the lead who asked; asking someone else to them', () => {
    const a = leadNoticesOf(block({ decisions: [said('question', { text: 'Which?' })] }), block({ decisions: [said('question', { text: 'Which?' }), { kind: 'answer', at: 't', round: 1, byName: 'Mia', text: 'Orders' }] }), base);
    expect(a).toMatchObject([{ kind: 'lead-answer', to: ['flo'], quote: 'Orders', waits: true }]);
    expect(leadNoticesOf(none, block({ leadAskedAt: 't', decisions: [said('asked-someone', { to: ['dana'] })] }), base).map((x) => [x.kind, x.to])).toContainEqual(['lead-delegated', ['dana']]);
  });
  it('sent back with an answer is one mail, not two; an edit that says nothing new, none', () => {
    const before = block({ decisions: [said('changes')] });
    const after = block({ leadAskedAt: 't', leadAskedTo: ['flo'], decisions: [said('changes'), { kind: 'answer', at: 't', round: 2, byName: 'Mia' }] });
    expect(leadNoticesOf(before, after, base).map((x) => x.kind)).toEqual(['lead-answer']);
    expect(leadNoticesOf(after, after, base)).toEqual([]);
  });
  it('reads it from an edited pull request, whoever wrote it', () => {
    const n = notifyEventsOf('pull_request', { action: 'edited', repository: { full_name: COPY }, sender: bot, changes: { body: { from: none } }, pull_request: { number: 7, body: block({ decisions: [said('changes', { text: 'x' })] }) } });
    expect(n.map((x) => x.kind)).toEqual(['lead-changes']);
    expect(notifyEventsOf('pull_request', { action: 'edited', repository: { full_name: COPY }, sender: bot, changes: { title: { from: 'x' } }, pull_request: { number: 7, body: none } })).toEqual([]);
  });

  it.each([
    ['lead-ask', 'Mia is done with Late tag', 'Look at it'],
    ['lead-answer', 'Mia answered about Late tag', 'Read it'],
    ['lead-delegated', 'Mia asks you to look at Late tag', 'Look at it'],
    ['lead-reminder', 'Late tag waits for you since 2 days', 'Look at it'],
    ['lead-question', 'Mia has a question about Late tag', 'Answer'],
    ['lead-changes', 'Mia asked for changes on Late tag', 'Read the note'],
    ['lead-took-back', 'Mia took Late tag back', 'Read why'],
    ['lead-not-doing', 'Late tag will not be done', 'Read why'],
    ['lead-handed', 'Mia handed Late tag to you', 'Open it'],
    ['lead-ok', 'Late tag went to the developers', 'See it'],
  ] as const)('%s reads for a designer', (kind, subject, button) => {
    const l = linesOf({ kind, title: 'Late tag', actor: 'Mia' });
    expect(l.subject).toBe(subject);
    expect(l.button).toBe(button);
    expect(`${l.subject} ${l.sentence}`).not.toMatch(/\u2014|pull request|issue|merge|repository/);
  });

  const setup = async () => {
    const redis = memoryRedis();
    const sent: EmailMessage[] = [];
    let now = T0;
    const d: NotifyDeps = { redis, sender: { send: async (m: EmailMessage) => void sent.push(m) } as EmailSender, secret: SECRET, origin: 'https://bridge.test', now: () => now, loginId: async (l: string) => (l === 'flo' ? 7 : null) };
    await redis.pipe(watchWrites([{ repo: COPY, meta: { team: TEAM, kind: 'copy', product: 'shop' } }]));
    await redis.cmd('SET', 'bridge:account:gh:7', 'florian@acme.design');
    await redis.cmd('SET', issueKey(COPY, 7), MIA);
    await memberStore(redis).put(TEAM, { email: MIA, name: 'Mia', role: 'edit', version: 1, addedBy: 'x', at: 't' });
    return { d, redis, sent, later: (ms: number) => (now += ms) };
  };

  it('a lead with a Bridge account gets it by email, on the exploration page; without one GitHub tells them', async () => {
    const { d, sent } = await setup();
    const out = await deliverNotices(leadNoticesOf(none, block({ leadAskedAt: 't', leadAskedByName: 'Mia', leadAskedTo: ['flo', 'dana'] }), base), d, 'e1');
    expect(out.map((o) => o.status)).toEqual(['sent', 'skipped']);
    expect(sent[0]!.to).toBe('florian@acme.design');
    expect(sent[0]!.text).toContain('changes/?exploration=7&product=shop');
  });
  it('the designer gets the lead\'s words; nobody hears about their own act', async () => {
    const { d, sent } = await setup();
    await deliverNotices(leadNoticesOf(none, block({ decisions: [said('changes', { text: 'Tighter' })] }), base), d, 'e2');
    expect(sent[0]!.to).toBe(MIA);
    expect(sent[0]!.text).toContain('Tighter');
    const own = await deliverNotices([{ kind: 'lead-ok', repo: COPY, items: [7], title: 'Late tag', actor: { login: '', id: null }, actorName: 'Mia', copy: null, scope: 'any' }], d, 'e3');
    expect(own).toEqual([{ kind: 'lead-ok', status: 'skipped', reason: 'own' }]);
    const self = await deliverNotices(leadNoticesOf(none, block({ leadAskedAt: 't', leadAskedBy: 'flo', leadAskedTo: ['flo'] }), base), d, 'e4');
    expect(self).toEqual([]);
  });
  it('went to the developers: in the daily summary', async () => {
    const { d, redis, sent } = await setup();
    const out = await deliverNotices(leadNoticesOf(none, block({ decisions: [said('looks-right')] }), base), d, 'e5');
    expect(out[0]!.status).toBe('kept');
    expect(sent).toEqual([]);
    expect(Number(await redis.cmd('ZCARD', digestKey(MIA)))).toBe(1);
  });
  it('reminds a lead once after 2 days, and not if someone answered', async () => {
    const { d, redis, sent, later } = await setup();
    const ask = leadNoticesOf(none, block({ leadAskedAt: 't', leadAskedByName: 'Mia', leadAskedTo: ['flo'] }), base);
    await deliverNotices(ask, d, 'e6');
    expect(sent).toHaveLength(1);
    later(1 * 24 * 60 * 60 * 1000);
    await sendReminders(d);
    expect(sent).toHaveLength(1);
    later(24 * 60 * 60 * 1000 + 1000);
    await redis.cmd('DEL', `bridge:notify:soon:florian@acme.design:${COPY}#7`);
    expect(await sendReminders(d)).toBe(1);
    expect(sent[1]!.subject).toBe('Late tag waits for you since 2 days');
    later(4 * 24 * 60 * 60 * 1000);
    expect(await sendReminders(d)).toBe(0);
    expect(sent).toHaveLength(2);

    await deliverNotices(ask, d, 'e7');
    await deliverNotices(leadNoticesOf(none, block({ decisions: [said('changes')] }), base), d, 'e8');
    expect(await redis.cmd('GET', waitingKey(COPY, 7))).toBeNull();
    later(4 * 24 * 60 * 60 * 1000);
    expect(await sendReminders(d)).toBe(0);
    expect(Number(await redis.cmd('ZCARD', REMIND_KEY))).toBe(0);
  });
});
