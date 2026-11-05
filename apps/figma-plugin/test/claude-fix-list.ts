// After "Ask Claude to fix all": a file where Claude worked through many components, reopened after Check for updates.
// Some fixes were approved (merged) and brought into this file, one was not kept (closed), some Claude cannot fix (parts
// to draw), one never reached Bridge's measure, one Claude did not finish, one is still on its way. Shared by the flow
// test and the screenshot script (one plugin per process: the UI module keeps its state).
import { type Harness, openPlugin, REPO } from './ui-harness';

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const pr = (number: number, branch: string, state: 'open' | 'closed', merged_at: string | null = null) => ({
  number,
  html_url: `https://github.com/${REPO}/pull/${number}`,
  title: `fix(figma): ${branch} drawn closer to its story`,
  draft: true,
  state,
  merged_at,
  head: { ref: `bridge/figma-fixes-${branch}`, sha: 'x' },
  base: { ref: 'main' },
  user: { login: 'claude' },
  labels: [{ name: 'figma-fixes' }, { name: 'drafted-by-claude' }],
  body: '',
  updated_at: '2026-11-05T12:39:08Z',
});

const MERGED_AT = '2026-11-05T12:39:08Z';
/** Check for updates, applied after the merge: the approved fixes are in this file. */
export const LAST_PULL_AT = '2026-11-05T12:40:00Z';

const session = (component: string, extra: Record<string, unknown>) => ({ component, startedAt: minutesAgo(80), updatedAt: minutesAgo(60), elapsed: 600, quiet: false, maxRounds: 3, ...extra });
const read = (n: number) => ({ label: `Claude read the differences (${n})`, status: 'done', at: '' });
const proposed = { label: 'Claude opened its fix for review', status: 'done', at: '' };

export const SESSIONS: Record<string, unknown> = {
  CheckboxGroup: session('CheckboxGroup', { state: 'ready', steps: [read(4), { label: 'Claude tried a fix (round 1): closer', status: 'done', at: '' }, proposed], pr: { number: 855, url: `https://github.com/${REPO}/pull/855` } }),
  CodeBlock: session('CodeBlock', { state: 'ready', steps: [read(2), { label: 'Claude tried a fix (round 1): closer', status: 'done', at: '' }, proposed], pr: { number: 856, url: `https://github.com/${REPO}/pull/856` } }),
  Form: session('Form', { state: 'ready', steps: [read(3), proposed], pr: { number: 857, url: `https://github.com/${REPO}/pull/857` } }),
  Avatar: session('Avatar', { state: 'ready', steps: [read(9), proposed], pr: { number: 864, url: `https://github.com/${REPO}/pull/864` } }),
  Spinner: session('Spinner', { state: 'stopped', reason: 'The indicator is missing in Figma: draw it in the component, then compare with code again.', steps: [read(6), { label: 'Claude stopped: The indicator is missing in Figma', status: 'failed', at: '' }] }),
  Switch: session('Switch', { state: 'stopped', reason: 'The dot and mark are missing in Figma: draw them in the component, then compare with code again.', steps: [read(8), { label: 'Claude stopped: The dot and mark are missing in Figma', status: 'failed', at: '' }] }),
  Tooltip: session('Tooltip', { state: 'working', quiet: true, steps: [read(5), { label: 'Claude went quiet', status: 'failed', at: '' }] }),
  AlertDialog: session('AlertDialog', { state: 'stopped', reason: "Bridge hasn't measured it in code yet, so there is nothing to compare it with. A developer measures it once.", steps: [] }),
};

export const ASKED = ['CheckboxGroup', 'CodeBlock', 'Form', 'Avatar', 'Spinner', 'Switch', 'Tooltip', 'AlertDialog', 'Popover', 'Menu'];

export async function openFixList(): Promise<Harness> {
  // Popover: asked a minute ago, nothing back yet (waiting). Menu: asked two hours ago, nothing ever came back.
  const asked = Object.fromEntries(ASKED.map((c) => [c, c === 'Popover' ? minutesAgo(1) : minutesAgo(120)]));
  const p = await openPlugin({
    pulled: true,
    sync: { claudeAsked: JSON.stringify(asked), claudeConnector: 'yes', lastPullAt: LAST_PULL_AT },
    register: (routes) =>
      routes.push((method, path, _body, url) => {
        if (path === '/api/fix-sessions' && method === 'GET') {
          const s = SESSIONS[url.searchParams.get('component') ?? ''];
          return s ? { status: 200, body: { session: s } } : { status: 200, body: { session: { component: url.searchParams.get('component'), state: 'waiting', startedAt: null, updatedAt: null, elapsed: 0, steps: [], quiet: false, maxRounds: 3 } } };
        }
        if (method === 'GET' && /\/pulls$/.test(path)) {
          if (url.searchParams.get('state') === 'closed')
            return { status: 200, body: [pr(855, 'checkbox-group', 'closed', MERGED_AT), pr(856, 'code-block', 'closed', MERGED_AT), pr(857, 'form', 'closed', MERGED_AT), pr(864, 'avatar', 'closed')] };
          return { status: 200, body: [] };
        }
        return undefined;
      }),
  });
  await p.until(() => p.document.querySelectorAll('[data-claude]').length >= 7 && !!p.document.querySelector('[data-claude="in-file"]'), 15000);
  return p;
}
