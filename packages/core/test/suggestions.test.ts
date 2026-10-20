import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  composeSuggestionIssue,
  defineConfig,
  gitBlobSha,
  hasSuggestionBlock,
  parseSuggestionIssue,
  sha256Hex,
  SUGGESTION_LIMITS,
  SUGGESTION_SCHEMA,
  suggestionIssueTitle,
  suggestionKindFromLabels,
  suggestionLabels,
  suggestionPathProblems,
  suggestionPayloadSha,
  SuggestionError,
  suggestionStateFromLabels,
  unsafePathProblem,
  type SuggestionPayloadV1,
} from '../src/index';
import { realConfig } from './helpers';

const BASE = 'e30fbcc4f1a2b3c4d5e6f708192a3b4c5d6e7f80';

const tokenSuggestion = (over: Partial<SuggestionPayloadV1> = {}): SuggestionPayloadV1 => ({
  schema: SUGGESTION_SCHEMA,
  kind: 'token-change',
  title: 'Raise color.action.primary.bg contrast',
  summary: 'White labels on the primary button read too light in dark mode.',
  source: 'studio',
  suggestedBy: 'ana',
  createdAt: '2026-10-21T09:00:00.000Z',
  base: { ref: 'main', sha: BASE },
  tier: { tier: 3, bump: 'minor' },
  tokens: {
    edits: [{ op: 'set', path: 'color.action.primary.bg', value: '{palette.harbor.700}', file: 'semantic/dark.tokens.json' }],
    changes: [{ kind: 'changed', path: 'color.action.primary.bg', file: 'semantic/dark.tokens.json', before: '{palette.harbor.500}', after: '{palette.harbor.700}', beforeCss: '#2f6f8f', afterCss: '#1d4a60' }],
  },
  files: [{ path: '.changeset/bridge-tokens-abc.md', beforeSha: null, afterSha: gitBlobSha('---\n"@bridge-ds/tokens": minor\n---\n\nDarker primary.\n'), content: '---\n"@bridge-ds/tokens": minor\n---\n\nDarker primary.\n' }],
  checks: { newErrors: 0, contrast: [{ pair: 'color.action.primary.fg on color.action.primary.bg', mode: 'dark', before: 3.9, after: 6.1, min: 4.5, pass: true }], blocked: null, impact: 4 },
  previews: [{ label: 'Storybook', url: 'https://bridge-storybook.floriangouloubi.com/iframe.html?id=actions-button--all-states' }],
  ...over,
});

/** Deterministic text with quotes, backslashes, newlines, accents and surrogate pairs, so escaping is exercised. */
function noisyText(n: number): string {
  const alphabet = ['a', 'b', 'c', ' ', '\n', '"', '\\', 'é', '\t', '😀', '{', '}', 'x', 'y', 'z', '\u0001'];
  let s = '';
  let x = 7;
  while (s.length < n) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += alphabet[x % alphabet.length];
  }
  return s;
}

const brandWithFile = (content: string): SuggestionPayloadV1 =>
  tokenSuggestion({ kind: 'brand', title: 'Add the coral brand', tokens: undefined, files: [{ path: 'packages/tokens/src/brands/coral.tokens.json', beforeSha: null, afterSha: gitBlobSha(content), content }] });

/** The comment authors GitHub would show: the issue author posts every part. */
const asComments = (parts: string[], author = 'ana') => parts.map((body) => ({ body, author }));

describe('hashes', () => {
  it('sha256 matches node:crypto, including multi-byte text and block boundaries', () => {
    for (const s of ['', 'abc', 'é😀"\\\n', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), noisyText(5000)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });

  it('gitBlobSha is the git object id of a text file', () => {
    expect(gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    const s = noisyText(3000);
    expect(gitBlobSha(s)).toBe(createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0${s}`, 'utf8').digest('hex'));
  });

  it('canonical JSON sorts keys at every depth, drops undefined, keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined, x: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"x":2,"z":1}]},"b":1}');
    const p = tokenSuggestion();
    const shuffled = Object.fromEntries(Object.entries(p).reverse()) as unknown as SuggestionPayloadV1;
    expect(Object.keys(shuffled)[0]).not.toBe(Object.keys(p)[0]);
    expect(suggestionPayloadSha(shuffled)).toBe(suggestionPayloadSha(p));
    // The transport field `part` is not in the sha.
    expect(suggestionPayloadSha({ ...p, files: p.files!.map((f) => ({ ...f, part: 2 })) })).toBe(suggestionPayloadSha(p));
    expect(suggestionPayloadSha({ ...p, title: 'Something else' })).not.toBe(suggestionPayloadSha(p));
  });
});

describe('compose and parse', () => {
  it('round-trips a token suggestion through the issue body', () => {
    const p = tokenSuggestion();
    const issue = composeSuggestionIssue(p, { labels: ['design-system'] });
    expect(issue.title).toBe('Tokens: raise color.action.primary.bg contrast');
    expect(issue.parts).toEqual([]);
    expect(issue.sha).toBe(suggestionPayloadSha(p));
    expect(issue.body.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.body);
    expect(issue.body).toContain('## Suggested change: Raise color.action.primary.bg contrast');
    expect(issue.body).toContain('| `color.action.primary.bg` | #2f6f8f | #1d4a60 |');
    expect(issue.body).toContain('<details><summary>Machine-readable change (Bridge suggestion v1)</summary>');
    expect(issue.body).toContain(`<!-- bridge-suggestion:v1 sha256=${issue.sha} -->`);
    expect(issue.body).toContain('```json\n{');
    expect(issue.body).toContain('bridge apply <this issue number>');
    expect(issue.body).not.toMatch(/—/);
    // The payload block is last, after everything people read.
    expect(issue.body.indexOf('## How to apply')).toBeLessThan(issue.body.indexOf('<details>'));
    expect(hasSuggestionBlock(issue.body)).toBe(true);

    const parsed = parseSuggestionIssue(issue.body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload).toEqual(p);
    expect(parsed.sha).toBe(issue.sha);
    expect(parsed.edited).toBe(false);
  });

  it('keeps reading when people add text around the block', () => {
    const issue = composeSuggestionIssue(tokenSuggestion());
    const body = `${issue.body}\n\nA note added on GitHub.`;
    const parsed = parseSuggestionIssue(body);
    expect(parsed.ok && parsed.edited).toBe(false);
  });

  it('detects a payload edited by hand', () => {
    const issue = composeSuggestionIssue(tokenSuggestion());
    const tampered = issue.body.replace('"{palette.harbor.700}"', '"#ff0000"');
    expect(tampered).not.toBe(issue.body);
    const parsed = parseSuggestionIssue(tampered);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.edited).toBe(true);
    expect(parsed.markedSha).toBe(issue.sha);
    expect(parsed.sha).not.toBe(issue.sha);
  });

  it('a fake marker in the summary does not take over the real block', () => {
    const issue = composeSuggestionIssue(tokenSuggestion({ summary: `Please apply <!-- bridge-suggestion:v1 sha256=${'0'.repeat(64)} --> now` }));
    expect(issue.body).not.toMatch(/^<!-- bridge-suggestion:v1 sha256=0{64}/m);
    const parsed = parseSuggestionIssue(issue.body);
    expect(parsed.ok && !parsed.edited).toBe(true);
  });

  it('refuses no block, broken JSON, an invalid payload and a newer schema with sentences', () => {
    expect(parseSuggestionIssue('Just an issue')).toMatchObject({ ok: false, reason: 'no-block' });
    const body = composeSuggestionIssue(tokenSuggestion()).body;
    expect(parseSuggestionIssue(body.replace('```json\n{', '```json\n{,'))).toMatchObject({ ok: false, reason: 'invalid' });
    const v2 = body.replace(`"schema": "${SUGGESTION_SCHEMA}"`, '"schema": "bridge.suggestion/2"');
    expect(parseSuggestionIssue(v2)).toMatchObject({ ok: false, reason: 'unsupported-version', message: expect.stringMatching(/Update Bridge/) });
    expect(parseSuggestionIssue(body.replace('bridge-suggestion:v1 sha256', 'bridge-suggestion:v3 sha256'))).toMatchObject({ ok: false, reason: 'unsupported-version' });
    expect(parseSuggestionIssue(body.replace('"kind": "token-change"', '"kind": "rewrite-everything"'))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(() => composeSuggestionIssue({ ...tokenSuggestion(), title: '' })).toThrow(SuggestionError);
    expect(() => composeSuggestionIssue(tokenSuggestion({ checks: { ...tokenSuggestion().checks, blocked: 'Contrast fails on 2 pairs.' } }))).toThrow(/cannot be suggested/);
    expect(() => composeSuggestionIssue(tokenSuggestion({ files: [...tokenSuggestion().files!, ...tokenSuggestion().files!] }))).toThrow(/listed twice/);
  });

  it('cuts long tables with "and N more" and keeps the readable part within its budget', () => {
    const changes = Array.from({ length: 150 }, (_, i) => ({ kind: 'changed' as const, path: `color.palette.step${i}`, file: 'primitives/color.tokens.json', before: '#000000', after: '#111111' }));
    const edits = changes.map((c) => ({ op: 'set' as const, path: c.path, value: '#111111' }));
    const issue = composeSuggestionIssue(tokenSuggestion({ tokens: { edits, changes } }));
    const human = issue.body.slice(0, issue.body.indexOf('<details>'));
    expect(human.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.human);
    expect(human).toMatch(/and \d+ more/);
    const parsed = parseSuggestionIssue(issue.body);
    expect(parsed.ok && parsed.payload.tokens!.edits.length).toBe(150);
  });
});

describe('parts', () => {
  it('keeps a payload inline up to the 48,000 character budget, moves file contents to parts above it', () => {
    // Content length at which the compact JSON reaches the budget exactly ("a" is one character once escaped).
    const lenAt = (n: number) => canonicalJson(brandWithFile('a'.repeat(n))).length;
    const edge = 1000 + SUGGESTION_LIMITS.inline - lenAt(1000);
    expect(lenAt(edge)).toBe(SUGGESTION_LIMITS.inline);
    expect(composeSuggestionIssue(brandWithFile('a'.repeat(edge))).parts).toEqual([]);
    expect(composeSuggestionIssue(brandWithFile('a'.repeat(edge - 50))).parts).toEqual([]);
    const over = composeSuggestionIssue(brandWithFile('a'.repeat(edge + 50)));
    expect(over.parts.length).toBe(1);
    expect(over.body).toMatch(/<!-- bridge-suggestion:v1 sha256=[0-9a-f]{64} parts=1 -->/);
  });

  it('splits large contents into parts of at most 60,000 characters and reassembles them exactly', () => {
    const big = noisyText(150_000);
    const p = tokenSuggestion({
      kind: 'revert',
      title: 'Revert the ocean brand',
      tokens: undefined,
      files: [
        { path: 'packages/tokens/src/brands/ocean.tokens.json', beforeSha: 'a'.repeat(40), afterSha: gitBlobSha(big), content: big },
        { path: 'packages/tokens/src/brands/old.tokens.json', beforeSha: 'b'.repeat(40), afterSha: null, content: null },
        { path: '.changeset/revert-ocean.md', beforeSha: null, afterSha: gitBlobSha('---\n"@bridge-ds/tokens": patch\n---\n\nRevert.\n'), content: '---\n"@bridge-ds/tokens": patch\n---\n\nRevert.\n' },
      ],
    });
    const issue = composeSuggestionIssue(p);
    expect(issue.parts.length).toBeGreaterThanOrEqual(3);
    expect(issue.parts.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.maxParts);
    expect(issue.body.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.body);
    for (const [i, part] of issue.parts.entries()) {
      expect(part.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.body);
      const json = /```json\n([\s\S]*?)\n```/.exec(part)![1]!;
      expect(json.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.part);
      expect(part).toContain(`part ${i + 1}/${issue.parts.length} sha256=${sha256Hex(json)}`);
    }
    // The body holds no file content, only where it starts.
    const inline = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(issue.body)![1]!) as SuggestionPayloadV1;
    expect(inline.files![0]).toMatchObject({ part: 1 });
    expect(inline.files![0]!.content).toBeUndefined();
    expect(inline.files![1]!.content).toBeNull();

    const parsed = parseSuggestionIssue(issue.body, { comments: [{ body: 'Looks good', author: 'dev' }, ...asComments(issue.parts)], author: 'ana' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.parts).toBe(issue.parts.length);
    expect(parsed.payload.files![0]!.content).toBe(big);
    expect(parsed.payload).toEqual(p);
    expect(parsed.sha).toBe(issue.sha);
    expect(parsed.edited).toBe(false);
  });

  it('refuses a suggestion with a missing part, and ignores parts posted by someone else', () => {
    const issue = composeSuggestionIssue(brandWithFile(noisyText(130_000)));
    expect(issue.parts.length).toBeGreaterThan(1);
    const missing = parseSuggestionIssue(issue.body, { comments: asComments(issue.parts.slice(1)), author: 'ana' });
    expect(missing).toMatchObject({ ok: false, reason: 'missing-part', message: expect.stringMatching(/part 1 of \d+ is missing/) });
    const impostor = parseSuggestionIssue(issue.body, { comments: [...asComments(issue.parts.slice(0, 1), 'mallory'), ...asComments(issue.parts.slice(1))], author: 'ana' });
    expect(impostor).toMatchObject({ ok: false, reason: 'missing-part' });
  });

  it('flags a part edited by hand', () => {
    const issue = composeSuggestionIssue(brandWithFile(noisyText(70_000)));
    const edited = issue.parts.map((b, i) => (i === 0 ? b.replace(/"text": "(.)/, '"text": "Z') : b));
    const parsed = parseSuggestionIssue(issue.body, { comments: asComments(edited), author: 'ana' });
    expect(parsed.ok && parsed.edited).toBe(true);
  });

  it('refuses a payload above 8 parts with a sentence that says what to do', () => {
    try {
      composeSuggestionIssue(brandWithFile(noisyText(600_000)));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SuggestionError);
      expect((err as SuggestionError).code).toBe('too-large');
      expect((err as Error).message).toBe('Too large for a suggestion: split it, or ask a developer to open it directly.');
    }
  });
});

describe('labels and title', () => {
  it('names the list key, kind, source, tier, one state and the marks it carries', () => {
    const neededBy = { pr: 12, title: 'Checkout', branch: 'feat/checkout', url: 'https://github.com/o/r/pull/12', product: 'admin', productName: 'Admin demo', piece: 'p1', pieceTitle: 'Danger tone' };
    const p = tokenSuggestion({ source: 'figma', links: { neededBy, exploration: 'explore/coral' } });
    expect(suggestionLabels(p, { labels: ['source: mcp', 'design-system'] })).toEqual([
      'bridge-suggestion',
      'suggestion: token-change',
      'source: figma',
      'tier: 3',
      'suggestion: needs review',
      'needed-by-product',
      'from-figma',
      'exploration',
      'source: mcp',
      'design-system',
    ]);
    expect(suggestionLabels(tokenSuggestion(), { state: 'approved' })).toEqual(['bridge-suggestion', 'suggestion: token-change', 'source: studio', 'tier: 3', 'suggestion: approved']);
    expect(suggestionKindFromLabels(['x', 'suggestion: docs', 'suggestion: approved'])).toBe('docs');
    expect(suggestionStateFromLabels(['suggestion: docs', 'suggestion: changes requested'])).toBe('changes-requested');
  });

  it('titles name the component for docs and specs', () => {
    expect(suggestionIssueTitle({ kind: 'docs', title: 'Docs for the danger tone.', docs: [{ component: 'Button', path: 'x', after: {} }] })).toBe('Button: docs for the danger tone');
    expect(suggestionIssueTitle({ kind: 'component-spec', title: 'Add a danger tone (from Figma)', componentSpec: { component: 'Badge', specPath: '.bridge/figma/badge.json', spec: {}, brief: '' } })).toBe('Badge: add a danger tone (from Figma)');
    expect(suggestionIssueTitle({ kind: 'config', title: 'Switch to suggestions' })).toBe('Settings: switch to suggestions');
  });
});

describe('path safety', () => {
  it('refuses paths that leave the repository or are not plain', () => {
    const table: [string, boolean][] = [
      ['packages/tokens/src/brands/coral.tokens.json', true],
      ['.changeset/a.md', true],
      ['../etc/passwd', false],
      ['packages/../../x', false],
      ['/etc/passwd', false],
      ['C:/Windows/x', false],
      ['~/x', false],
      ['packages\\tokens\\x.json', false],
      ['packages//x', false],
      ['./packages/x', false],
      ['.git/config', false],
      ['packages/.git/hooks/pre-commit', false],
      ['a\nb', false],
      ['', false],
    ];
    for (const [path, ok] of table) expect([path, unsafePathProblem(path) === null]).toEqual([path, ok]);
  });

  it('keeps each kind inside its folders and off guardrails', () => {
    const c = realConfig();
    expect(suggestionPathProblems(tokenSuggestion(), c)).toEqual([]);
    const outside = tokenSuggestion({ files: [{ path: 'packages/react/src/components/Button/Button.tsx', beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), content: 'x' }] });
    expect(suggestionPathProblems(outside, c)[0]).toMatch(/outside what a token-change suggestion may change/);
    const contrast = tokenSuggestion({ files: [{ path: 'packages/tokens/src/contrast.checks.json', beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), content: '{}' }] });
    expect(suggestionPathProblems(contrast, c)[0]).toMatch(/guardrail/);
    const badEditFile = tokenSuggestion({ tokens: { edits: [{ op: 'set', path: 'x', value: 1, file: '../../secrets.json' }], changes: [] } });
    expect(suggestionPathProblems(badEditFile, c)[0]).toMatch(/stay inside the repository/);

    const docs = tokenSuggestion({ kind: 'docs', tokens: undefined, files: undefined, docs: [{ component: 'Button', path: 'packages/react/src/components/Button/Button.docs.json', after: {} }] });
    expect(suggestionPathProblems(docs, c)).toEqual([]);
    expect(suggestionPathProblems({ ...docs, docs: [{ component: 'Button', path: 'AGENTS.md', after: {} }] }, c)[0]).toMatch(/outside/);

    const spec = tokenSuggestion({ kind: 'component-spec', tokens: undefined, files: undefined, componentSpec: { component: 'Badge', specPath: '.bridge/figma/badge.json', spec: {}, brief: 'b' } });
    expect(suggestionPathProblems(spec, c)).toEqual([]);
    expect(suggestionPathProblems({ ...spec, componentSpec: { ...spec.componentSpec!, specPath: '.github/workflows/x.yml' } }, c)[0]).toMatch(/outside/);

    const config = tokenSuggestion({ kind: 'config', tokens: undefined, files: [{ path: 'bridge.config.json', beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), content: '{}' }] });
    expect(suggestionPathProblems(config, c)).toEqual([]);
    expect(suggestionPathProblems({ ...config, files: [{ path: 'AGENTS.md', beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), content: '' }] }, c)[0]).toMatch(/outside/);

    // A revert may touch any file, never a guardrail.
    const revert = tokenSuggestion({ kind: 'revert', tokens: undefined, files: [{ path: 'apps/admin/src/x.ts', beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), content: '' }] });
    expect(suggestionPathProblems(revert, c)).toEqual([]);
    for (const g of ['.github/workflows/ci.yml', 'AGENTS.md', 'bridge.config.json']) {
      expect(suggestionPathProblems({ ...revert, files: [{ path: g, beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), content: '' }] }, c)[0]).toMatch(/guardrail/);
    }
    // Brand writes the config (its mode list) and token files.
    expect(suggestionPathProblems(brandWithFile('{}'), c)).toEqual([]);
    expect(suggestionPathProblems({ ...brandWithFile('{}'), files: [{ path: 'bridge.config.json', beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), content: '{}' }] }, c)).toEqual([]);
  });

  it('uses the defaults of a minimal config', () => {
    const c = defineConfig({ repo: { owner: 'acme', name: 'ds' }, changesets: { package: '@acme/tokens' } });
    expect(suggestionPathProblems(tokenSuggestion({ files: [{ path: 'tokens/semantic/light.tokens.json', beforeSha: 'a'.repeat(40), afterSha: 'b'.repeat(40), content: '{}' }] }), c)).toEqual([]);
  });
});
