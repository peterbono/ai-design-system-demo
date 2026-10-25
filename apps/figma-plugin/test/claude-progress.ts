// Shared by the flow-claude-* state tests: a file where the designer asked Claude to fix IconButton earlier, reopened.
// The plugin resumes: it reads Claude's steps from the Bridge site (or, when it cannot, watches GitHub for the fix) and
// shows the row under "Claude's fixes" on Pull. One plugin per test file (the UI module keeps its state).
import { type Harness, openPlugin } from './ui-harness';

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export async function reopenWith(answer: { session?: unknown; prs?: unknown[] }): Promise<Harness & { row: () => Element | null }> {
  const p = await openPlugin({
    pulled: true,
    sync: { claudeAsked: JSON.stringify({ IconButton: minutesAgo(6) }), claudeConnector: 'yes' },
    register: (routes) =>
      routes.push((method, path) => {
        if (path === '/api/fix-sessions' && method === 'GET') return answer.session ? { status: 200, body: { session: answer.session } } : { status: 404, body: { error: 'not_found' } };
        if (method === 'GET' && /\/pulls$/.test(path)) return { status: 200, body: answer.prs ?? [] };
        return undefined;
      }),
  });
  const row = () => p.document.querySelector('[data-claude]');
  await p.until(() => !!row());
  return Object.assign(p, { row });
}

export const fixPr = { number: 91, html_url: 'https://github.com/acme/acme-design-system/pull/91', title: 'Figma fixes: IconButton', draft: true, state: 'open', head: { ref: 'bridge/figma-fixes-icon-button', sha: 'x' }, base: { ref: 'main' }, user: { login: 'claude' }, labels: [{ name: 'figma-fixes' }, { name: 'drafted-by-claude' }], body: '', updated_at: '2026-10-25T10:00:00Z' };
