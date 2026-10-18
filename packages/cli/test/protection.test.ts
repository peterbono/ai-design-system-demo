// bridge check: the protection line, with a stubbed GitHub (no network).
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@bridge-ds/core';
import { protectionReport } from '../src/protection.js';

const REPO = 'acme/ds';

function stub(routes: Record<string, { status?: number; body: unknown }>): { fetch: FetchLike; methods: string[] } {
  const methods: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    methods.push(method);
    const route = routes[`${method} ${url.replace('https://api.github.com', '')}`];
    const status = route ? (route.status ?? 200) : 404;
    const body = route ? route.body : { message: 'Not Found' };
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { fetch, methods };
}

const full = {
  id: 7,
  name: 'Protect the library (main)',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'pull_request', parameters: { required_approving_review_count: 1 } },
    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Unit tests' }] } },
  ],
  _links: { html: { href: 'https://github.com/acme/ds/rules/7' } },
};

describe('bridge check: protection', () => {
  it('protected: one line with where to see the rule, reads only', async () => {
    const gh = stub({
      'GET /repos/acme/ds/rulesets?includes_parents=true&per_page=100': { body: [{ id: 7, name: full.name, enforcement: 'active' }] },
      'GET /repos/acme/ds/rulesets/7': { body: full },
      'GET /repos/acme/ds/branches/main/protection': { status: 404, body: { message: 'Branch not protected' } },
    });
    const r = await protectionReport({ repo: REPO, defaultBranch: 'main', token: 't', fetch: gh.fetch });
    expect(r.state.kind).toBe('protected');
    expect(r.lines[0]).toBe('protection: Protected: every change goes through review.');
    expect(r.lines[1]).toContain('https://github.com/acme/ds/rules/7');
    expect(gh.methods.every((m) => m === 'GET')).toBe(true);
  });

  it('unprotected: the sentence and where to fix it', async () => {
    const gh = stub({
      'GET /repos/acme/ds/rulesets?includes_parents=true&per_page=100': { body: [] },
      'GET /repos/acme/ds/branches/main/protection': { status: 404, body: { message: 'Branch not protected' } },
    });
    const r = await protectionReport({ repo: REPO, defaultBranch: 'main', token: 't', fetch: gh.fetch });
    expect(r.state.kind).toBe('unprotected');
    expect(r.lines.join('\n')).toMatch(/can be changed without review[\s\S]*Studio > Settings, or GitHub settings > Rules: https:\/\/github\.com\/acme\/ds\/settings\/rules/);
  });

  it('offline or refused: unknown, never throws', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('offline');
    };
    const r = await protectionReport({ repo: REPO, defaultBranch: 'main', fetch });
    expect(r.state.kind).toBe('unknown');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/^protection: /);
  });
});
