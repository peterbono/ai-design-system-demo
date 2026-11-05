// Flow: a lead approves Claude's fixes from the plugin. Bridge says this sign-in approves (POST /api/ship
// can-approve-fixes), so "Approve all N" shows on the section and "Approve" on each ready row. One click sends every
// ready fix with the head the plugin saw; the approved rows say so and Check for updates runs; a fix Bridge refused keeps
// its row with the reason, and its own Approve lands it later. (A contributor's rows: flow-claude-ready.test.ts.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPROVE_FIX_WORDS } from '../src/sync/approve-fixes';
import { minutesAgo } from './claude-progress';
import { openPlugin, REPO } from './ui-harness';

const COMPONENTS = { Avatar: 101, Badge: 102, Chip: 103 } as const;
const sha = (n: number) => String(n).repeat(14).slice(0, 40);
const pr = (component: string, number: number) => ({
  number,
  html_url: `https://github.com/${REPO}/pull/${number}`,
  title: `fix(figma): ${component} drawn closer to its story`,
  draft: true,
  state: 'open',
  head: { ref: `bridge/figma-fixes-${component.toLowerCase()}`, sha: sha(number) },
  base: { ref: 'main' },
  user: { login: 'claude' },
  labels: [{ name: 'figma-fixes' }, { name: 'drafted-by-claude' }],
  body: '',
  updated_at: '2026-11-05T12:39:08Z',
});
const session = (component: string, number: number) => ({ component, state: 'ready', startedAt: minutesAgo(20), updatedAt: minutesAgo(5), elapsed: 900, quiet: false, maxRounds: 3, steps: [{ label: 'Claude opened its fix for review', status: 'done', at: '' }], pr: { number, url: `https://github.com/${REPO}/pull/${number}` } });

test("a lead approves Claude's fixes: Approve all, refused ones keep their row, then Approve on one", async () => {
  const sent: any[] = [];
  let answer: (prs: number[]) => unknown = (prs) => ({ approved: prs.filter((n) => n !== 103).map((n) => ({ pr: n })), refused: [{ pr: 103, code: 'checks_pending', reason: 'Bridge is still checking this fix. Approve it again in a minute.' }], landed: true, how: 'together' });
  const p = await openPlugin({
    pulled: true,
    sync: { claudeAsked: JSON.stringify(Object.fromEntries(Object.keys(COMPONENTS).map((c) => [c, minutesAgo(30)]))), claudeConnector: 'yes' },
    register: (routes) =>
      routes.push((method, path, body, url) => {
        if (path === '/api/fix-sessions' && method === 'GET') {
          const c = url.searchParams.get('component') as keyof typeof COMPONENTS;
          return { status: 200, body: { session: session(c, COMPONENTS[c]) } };
        }
        if (path === '/api/ship' && method === 'POST') {
          sent.push(body);
          if (body.action === 'can-approve-fixes') return { status: 200, body: { canApprove: true } };
          if (body.action === 'approve-fixes') return { status: 200, body: answer(body.prs) };
        }
        if (method === 'GET' && /\/pulls$/.test(path)) return { status: 200, body: url.searchParams.get('state') === 'closed' ? [] : Object.entries(COMPONENTS).map(([c, n]) => pr(c, n)) };
        return undefined;
      }),
  });
  const d = p.document;
  const section = () => [...d.querySelectorAll('section.group')].find((s) => /Claude's fixes/.test(s.querySelector('h2')?.textContent ?? ''));
  const rowOf = (name: string) => [...d.querySelectorAll('li.row')].find((li) => li.querySelector('.comp-name')?.textContent === name);
  await p.until(() => d.querySelectorAll('[data-claude="ready"]').length === 3);
  await p.until(() => !!d.querySelector('[data-focus-id="approve-all-fixes"]'));

  // The lead's section: one sentence, Approve all 3 next to the title, Approve and See Claude's fix on each row.
  assert.equal(section()!.querySelector('.group-head button')!.textContent, APPROVE_FIX_WORDS.all(3));
  assert.equal(section()!.querySelector('.lede')!.textContent, '3 ready to approve.');
  for (const name of Object.keys(COMPONENTS)) {
    const labels = [...rowOf(name)!.querySelectorAll('button')].map((b) => b.textContent);
    assert.deepEqual(labels, ['Approve', "See Claude's fix"], name);
    assert.match(rowOf(name)!.textContent ?? '', /Approve it to bring it into this file\./);
  }
  // The bar keeps its one primary action.
  assert.equal(p.primary()?.textContent, 'Check for updates');

  const before = p.calls.length;
  await p.click(APPROVE_FIX_WORDS.all(3));
  await p.until(() => d.querySelectorAll('[data-claude="approved"]').length === 2);
  const approve = sent.find((b) => b.action === 'approve-fixes');
  assert.deepEqual(approve.prs, [101, 102, 103]);
  assert.deepEqual(approve.heads, { 101: sha(101), 102: sha(102), 103: sha(103) });
  assert.equal(approve.repo, REPO);
  assert.equal(rowOf('Avatar')!.querySelector('[data-claude]')!.textContent, "Claude's fix is approved. Check for updates brings it into this file.");
  // Refused: the row stays ready, with Bridge's reason in designer words, and its own Approve.
  assert.match(rowOf('Chip')!.textContent ?? '', /Bridge is still checking this fix\. Approve it again in a minute\./);
  // Check for updates ran right after.
  await p.until(() => p.calls.slice(before).includes('snapshot'));

  answer = (prs) => ({ approved: prs.map((n) => ({ pr: n })), refused: [], landed: true, how: 'merged' });
  // Once Check for updates is done (nothing competes with it), the refused fix's own Approve lands it.
  await p.until(() => rowOf('Chip')?.querySelector<HTMLButtonElement>('[data-focus-id="approve-fix-Chip"]')?.disabled === false);
  rowOf('Chip')!.querySelector<HTMLButtonElement>('[data-focus-id="approve-fix-Chip"]')!.click();
  await p.until(() => rowOf('Chip')?.querySelector('[data-claude]')?.getAttribute('data-claude') === 'approved');
  assert.deepEqual(sent.filter((b) => b.action === 'approve-fixes').at(-1).prs, [103]);
  // Asked once whether this sign-in approves, whatever the renders.
  assert.equal(sent.filter((b) => b.action === 'can-approve-fixes').length, 1);
  assert.doesNotMatch(p.text(), /—/);
});
