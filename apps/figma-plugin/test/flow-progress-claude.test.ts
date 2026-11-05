// Flow: the designer asked Claude to fix three components at once, then reopened the file. Claude fixes them one at a
// time: Claude's fixes shows one bar for the list above its rows, with the components finished (ready, can't fix...)
// out of three and the time left from the fixes Claude already finished.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { minutesAgo } from './claude-progress';
import { openPlugin } from './ui-harness';

const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Step ${i + 1}`, status: i === n - 1 ? 'current' : 'done', at: minutesAgo(1) }));

test("Ask Claude to fix all: one bar for the list, components finished of three, time left from Claude's finished fixes", async () => {
  const at = minutesAgo(9);
  const sessions: Record<string, unknown> = {
    Badge: { component: 'Badge', state: 'ready', startedAt: minutesAgo(9), updatedAt: minutesAgo(5), elapsed: 240, quiet: false, maxRounds: 3, steps: steps(3).map((s) => ({ ...s, status: 'done' })), pr: { number: 92, url: 'https://github.com/acme/acme-design-system/pull/92' } },
    IconButton: { component: 'IconButton', state: 'working', startedAt: minutesAgo(5), updatedAt: minutesAgo(1), elapsed: 60, quiet: false, round: 1, maxRounds: 3, steps: steps(2) },
  };
  const p = await openPlugin({
    pulled: true,
    sync: { claudeAsked: JSON.stringify({ Badge: at, IconButton: at, Tooltip: at }), claudeConnector: 'yes' },
    register: (routes) =>
      routes.push((method, path, _body, url) => {
        if (path === '/api/fix-sessions' && method === 'GET') {
          const s = sessions[url.searchParams.get('component') ?? ''];
          return s ? { status: 200, body: { session: s } } : { status: 404, body: { error: 'not_found' } };
        }
        if (method === 'GET' && /\/pulls$/.test(path)) return { status: 200, body: [] };
        return undefined;
      }),
  });
  const bar = () => p.document.querySelector('[data-progress="claude"]');
  await p.until(() => !!bar() && /IconButton/.test(bar()!.textContent ?? ''));
  const track = bar()!.querySelector('[role="progressbar"]')!;
  assert.equal(bar()!.querySelector('.progress-label')!.textContent, 'Claude is fixing IconButton, 2 of 3');
  assert.equal(track.getAttribute('aria-valuenow'), '1', 'Badge is finished: its fix is ready');
  assert.equal(track.getAttribute('aria-valuemax'), '3');
  assert.equal(bar()!.querySelector('.progress-pct')!.textContent, '33%');
  // Badge took 4 min; IconButton is 1 min in and Tooltip is left: 4 x 2 - 1 = 7 min.
  assert.equal(bar()!.querySelector('.progress-eta')!.textContent, 'About 7 min left');
  assert.equal(track.getAttribute('aria-valuetext'), '33%, 1 of 3 components, about 7 min left');
  // Above the rows of Claude's fixes, once: the rows keep their own status.
  const group = bar()!.closest('section.group')!;
  assert.match(group.querySelector('h2')!.textContent ?? '', /Claude's fixes/);
  assert.equal(p.document.querySelectorAll('[data-progress]').length, 1);
  assert.ok(group.querySelector('[data-claude="working"]') && group.querySelector('[data-claude="ready"]'));
  assert.doesNotMatch(p.text(), /\u2014/);
});
