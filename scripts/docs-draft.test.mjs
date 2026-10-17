import { describe, expect, it } from 'vitest';
import { formatDocs, MARKER, mergeDraft, missingProse, OFF_MESSAGE, parseReply, run, selectTargets, upsertComment } from './docs-draft.mjs';

const EVENT = '/tmp/event.json';
const PR = { number: 7, base: { sha: 'base1' }, head: { ref: 'feat/icon', repo: { full_name: 'o/r' } } };

/** A fake fetch: GitHub comments in memory, every other host recorded and refused. */
function fakeFetch(initial = []) {
  const comments = [...initial];
  const calls = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url: String(url), body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const u = new URL(String(url));
    if (u.host !== 'api.github.com') return json(500, { message: 'unexpected host' });
    let m;
    if (method === 'GET' && /\/issues\/7\/comments$/.test(u.pathname)) return json(200, comments);
    if (method === 'POST' && /\/issues\/7\/comments$/.test(u.pathname)) {
      const c = { id: 100 + comments.length, body: JSON.parse(init.body).body };
      comments.push(c);
      return json(201, c);
    }
    if (method === 'PATCH' && (m = /\/issues\/comments\/(\d+)$/.exec(u.pathname))) {
      const c = comments.find((x) => x.id === Number(m[1]));
      c.body = JSON.parse(init.body).body;
      return json(200, c);
    }
    return json(404, {});
  };
  return { fetch: f, comments, calls };
}

const baseDeps = (over = {}) => ({
  env: { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_PATH: EVENT },
  readFile: (p) => (p === EVENT ? JSON.stringify({ pull_request: PR }) : '{}'),
  writeFile: () => {
    throw new Error('must not write');
  },
  exists: () => false,
  exec: () => {
    throw new Error('must not run commands');
  },
  log: () => {},
  ...over,
});

describe('docs-draft without ANTHROPIC_API_KEY', () => {
  it('creates the one comment, exits 0, never calls Anthropic nor git', async () => {
    const gh = fakeFetch();
    const code = await run(baseDeps({ fetchImpl: gh.fetch }));
    expect(code).toBe(0);
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0].body).toBe(`${MARKER}\n${OFF_MESSAGE}`);
    expect(gh.calls.some((c) => c.url.includes('anthropic.com'))).toBe(false);
    expect(gh.calls.find((c) => c.method === 'POST').headers.authorization).toBe('Bearer t');
  });

  it('updates the existing comment instead of adding another', async () => {
    const gh = fakeFetch([
      { id: 1, body: 'LGTM' },
      { id: 2, body: `${MARKER}\nold text` },
    ]);
    expect(await run(baseDeps({ fetchImpl: gh.fetch, env: { ...baseDeps().env, ANTHROPIC_API_KEY: '' } }))).toBe(0);
    expect(gh.comments).toHaveLength(2);
    expect(gh.comments[1].body).toBe(`${MARKER}\n${OFF_MESSAGE}`);
    expect(gh.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(gh.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('does nothing outside a pull request workflow', async () => {
    const gh = fakeFetch();
    expect(await run(baseDeps({ fetchImpl: gh.fetch, env: {} }))).toBe(0);
    expect(gh.calls).toHaveLength(0);
  });

  it('upsertComment reports what it did', async () => {
    const gh = fakeFetch();
    expect((await upsertComment({ fetchImpl: gh.fetch, token: 't', repo: 'o/r', pr: 7, body: 'a' })).action).toBe('created');
    expect((await upsertComment({ fetchImpl: gh.fetch, token: 't', repo: 'o/r', pr: 7, body: 'b' })).action).toBe('updated');
    expect(gh.comments).toHaveLength(1);
  });
});

describe('docs-draft with the key', () => {
  it('skips pull requests from forks and its own draft commits, without calling Anthropic', async () => {
    const gh = fakeFetch();
    const fork = { ...PR, head: { ref: 'x', repo: { full_name: 'someone/r' } } };
    const env = { ...baseDeps().env, ANTHROPIC_API_KEY: 'k' };
    expect(await run(baseDeps({ fetchImpl: gh.fetch, env, readFile: () => JSON.stringify({ pull_request: fork }) }))).toBe(0);
    const exec = (cmd, args) => (args[0] === 'log' ? 'docs(icon): draft usage guidance with Claude, needs review\n' : '');
    expect(await run(baseDeps({ fetchImpl: gh.fetch, env, exec }))).toBe(0);
    expect(gh.calls).toHaveLength(0);
  });
});

describe('docs-draft drafting path', () => {
  it('asks Claude once per target, writes a marked draft, commits, pushes and reports', async () => {
    const gh = fakeFetch();
    const sent = [];
    const fetchImpl = async (url, init = {}) => {
      if (String(url) === 'https://api.anthropic.com/v1/messages') {
        sent.push({ headers: init.headers, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"summary":"x","whenToUse":["Next to a label."]}' }] }), { status: 200 });
      }
      return gh.fetch(url, init);
    };
    const cmds = [];
    const written = {};
    const prefill = { path: 'packages/react/src/components/Icon/Icon.docs.json', prompt: 'PROMPT', prefill: { draft: { summary: 'From code.', whenToUse: [], anatomy: { icon: 'Icon' } } } };
    const exec = (cmd, args) => {
      cmds.push([cmd, ...args].join(' '));
      if (args[0] === 'log') return 'feat(icon): new size\n';
      if (args[0] === 'diff') return 'packages/react/src/components/Icon/Icon.tsx\n';
      if (args[0] === 'ls-files') return 'packages/react/src/components/Icon/Icon.tsx\n';
      if (cmd === 'node') return JSON.stringify(prefill);
      return '';
    };
    const code = await run(baseDeps({ fetchImpl, env: { ...baseDeps().env, ANTHROPIC_API_KEY: 'k' }, exec, writeFile: (p, t) => (written[p] = t) }));
    expect(code).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'PROMPT' }] });
    expect(sent[0].headers['x-api-key']).toBe('k');
    const doc = JSON.parse(written['packages/react/src/components/Icon/Icon.docs.json']);
    expect(doc).toMatchObject({ summary: 'From code.', whenToUse: ['Next to a label.'], draftedBy: 'claude', needsReview: true });
    expect(cmds.some((c) => c.includes('commit') && c.includes('docs(icon): draft usage guidance with Claude, needs review'))).toBe(true);
    expect(cmds).toContain('git push origin HEAD:feat/icon');
    expect(gh.comments[0].body).toMatch(/Claude drafted usage guidance for 1 component/);
  });
});

describe('target selection', () => {
  const docs = { Button: { summary: 's', whenToUse: ['a'], whenNotToUse: ['a'], dos: [{}], donts: [{}], accessibility: ['a'], contentGuidelines: ['a'] }, Card: { summary: 's', whenToUse: [] } };
  const readDocs = (n) => docs[n] ?? null;
  const dir = 'packages/react/src/components';

  it('drafts missing docs, empty prose, and code that moved without its docs', () => {
    const changed = [`${dir}/Icon/Icon.tsx`, `${dir}/Button/Button.module.css`, `${dir}/Card/Card.stories.tsx`, `${dir}/Tag/Tag.docs.json`, 'docs/AI.md'];
    expect(selectTargets({ changed, readDocs })).toEqual([
      { name: 'Button', reason: 'code changed, docs did not' },
      { name: 'Card', reason: 'missing whenToUse, whenNotToUse, dos, donts, accessibility, contentGuidelines' },
      { name: 'Icon', reason: 'no docs.json yet' },
      { name: 'Tag', reason: 'no docs.json yet' },
    ]);
  });

  it('leaves components alone when their docs change with the code', () => {
    expect(selectTargets({ changed: [`${dir}/Button/Button.tsx`, `${dir}/Button/Button.docs.json`], readDocs })).toEqual([]);
  });

  it('a token change adds the components with missing or incomplete docs', () => {
    const r = selectTargets({ changed: ['packages/tokens/src/semantic/light.tokens.json'], readDocs, all: ['Button', 'Card', 'VisuallyHidden'] });
    expect(r.map((t) => t.name)).toEqual(['Card', 'VisuallyHidden']);
  });
});

describe('reply parsing and merge', () => {
  it('reads a plain or fenced JSON object, and fails on prose', () => {
    expect(parseReply('{"summary":"x"}')).toEqual({ summary: 'x' });
    expect(parseReply('Here it is:\n```json\n{"summary":"y","dos":[]}\n```\nDone.')).toEqual({ summary: 'y', dos: [] });
    expect(() => parseReply('I cannot help with that.')).toThrow(/no JSON/);
    expect(() => parseReply('[1, 2]')).toThrow();
  });

  it('keeps anatomy and existing prose from the pre-fill, marks the draft for review', () => {
    const pre = { summary: 'From the code.', whenToUse: [], whenNotToUse: [], dos: [], donts: [], accessibility: [], contentGuidelines: [], anatomy: { icon: 'Icon' } };
    const reply = { summary: 'Invented summary', whenToUse: ['Next to a label.'], anatomy: { icon: 'Changed' }, needsReview: false };
    const d = mergeDraft(pre, reply);
    expect(d.summary).toBe('From the code.');
    expect(d.whenToUse).toEqual(['Next to a label.']);
    expect(d.anatomy).toEqual({ icon: 'Icon' });
    expect(d).toMatchObject({ draftedBy: 'claude', needsReview: true });
    const text = formatDocs(d);
    expect(Object.keys(JSON.parse(text))).toEqual(['summary', 'whenToUse', 'whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines', 'anatomy', 'draftedBy', 'needsReview']);
    expect(text.endsWith('}\n')).toBe(true);
    expect(missingProse(d)).toEqual(['whenNotToUse', 'dos', 'donts', 'accessibility', 'contentGuidelines']);
  });
});
