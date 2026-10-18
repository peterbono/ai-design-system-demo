// Docs drafted with Claude: tasks, prompts, answer parsing and sanitizing, review marks per section, the Messages API
// request, and docs items in the draft exchange (Bridge Studio asks the user's own Claude through the MCP server).
import { describe, expect, it } from 'vitest';
import {
  type ComponentDocsJson,
  type DraftItem,
  DraftPoller,
  PROSE_KEYS,
  acceptDocsDraft,
  anthropicReplyText,
  anthropicRequest,
  applyDocsSections,
  composePendingDrafts,
  createDocsDraftSession,
  draftItemBrief,
  ensureRequestsBranch,
  formatDocsJson,
  markClaudeDraft,
  mergeDocsDraft,
  mergeDraftResults,
  parseDocsReply,
  parseDocsTaskAnswer,
  parsePendingDrafts,
  prefillDocs,
  REQUESTS_BRANCH,
  sanitizeDocsSections,
  sectionsNeedingReview,
  serializePendingDrafts,
  validateDocsTask,
  validatePendingDrafts,
  docsPrompt,
  docsTaskPrompt,
} from '../src/index';

const EM = '\u2014';
const prefill = prefillDocs({ name: 'Badge', description: 'Short status label.', props: [{ name: 'tone', type: "'info' | 'danger'", required: false }], tokens: ['--color-text-default'], cssClasses: ['root'], existing: { summary: 'Shows a status.', dos: [] } });

describe('docs tasks and prompts', () => {
  it('a sections prompt asks only for those keys and their shapes', () => {
    const p = docsTaskPrompt(prefill, { voice: 'Sentence case.' }, { kind: 'sections', keys: ['dos', 'accessibility'], check: ['accessibility'] });
    expect(p).toMatch(/^Write these sections of Badge\.docs\.json for the Bridge design system: dos\./);
    expect(p).toMatch(/Check these written sections of Badge\.docs\.json against the current code: accessibility\./);
    expect(p).toMatch(/Return a checked section ONLY when something in it is no longer true for the code/);
    expect(p).toMatch(/a missing key means unchanged/);
    expect(p).toContain('{ "dos": [{ "title": "...", "text": "..." }], "accessibility": ["..."] }');
    expect(p).not.toMatch(/full docs\.json/);
    expect(p).toContain('<voice>');
  });

  it('a selection prompt quotes the passage and the mode', () => {
    const p = docsTaskPrompt(prefill, {}, { kind: 'selection', key: 'summary', text: 'Shows a status.', mode: 'shorter' });
    expect(p).toMatch(/Make it shorter/);
    expect(p).toContain('<passage>\nShows a status.\n</passage>');
    expect(p).toContain('"replacement"');
  });

  it('without options the prompt is the Action one: the missing prose as a full docs.json', () => {
    expect(docsTaskPrompt(prefill, {}, { kind: 'sections', keys: ['dos'] })).not.toContain('Fill only these keys');
    const action = docsPrompt(prefill);
    expect(action).toMatch(/^Write the missing prose of Badge\.docs\.json/);
    expect(action).toContain('Answer with the full docs.json as one JSON object, nothing else.');
  });

  it('validates tasks', () => {
    expect(validateDocsTask({ kind: 'sections', keys: ['dos'] })).toEqual([]);
    expect(validateDocsTask({ kind: 'sections', keys: ['anatomy'] })[0]).toMatch(/no sections/);
    expect(validateDocsTask({ kind: 'selection', key: 'summary', text: '', mode: 'louder' })).toHaveLength(2);
    expect(validateDocsTask(null)).toHaveLength(1);
  });
});

describe('answers', () => {
  it('parses plain or fenced JSON and fails on prose', () => {
    expect(parseDocsReply('{"summary":"x"}')).toEqual({ summary: 'x' });
    expect(parseDocsReply('Sure:\n```json\n{"dos":[]}\n```')).toEqual({ dos: [] });
    expect(() => parseDocsReply('No.')).toThrow(/no JSON/);
    expect(() => parseDocsReply('[1]')).toThrow();
  });

  it('sanitizes to the docs.json shapes: only the keys, no em dash, no broken items, examples only when asked', () => {
    const raw = {
      summary: `A label ${EM} short.\nTwo lines.`,
      whenToUse: ['Next to a name.', '', 3, `In tables ${EM} always.`],
      whenNotToUse: 'For actions.',
      dos: [{ title: 'Short', text: 'One word.', example: { c: 'Badge', p: { tone: 'danger' } } }, { title: 'No text' }, 'nope'],
      donts: [{ title: 'Bad', text: 'Ok.', example: { p: {} } }],
      anatomy: { root: 'Invented' },
    };
    const out = sanitizeDocsSections(raw);
    expect(out).toEqual({
      summary: 'A label, short. Two lines.',
      whenToUse: ['Next to a name.', 'In tables, always.'],
      whenNotToUse: ['For actions.'],
      dos: [{ title: 'Short', text: 'One word.' }],
      donts: [{ title: 'Bad', text: 'Ok.' }],
    });
    expect(sanitizeDocsSections(raw, ['dos'], { examples: true })).toEqual({ dos: [{ title: 'Short', text: 'One word.', example: { c: 'Badge', p: { tone: 'danger' } } }] });
    expect(sanitizeDocsSections('nope')).toEqual({});
  });

  it('a selection answer is the replacement only; sections need at least one asked key', () => {
    const sel = { kind: 'selection' as const, key: 'summary' as const, text: 'x', mode: 'voice' as const };
    expect(parseDocsTaskAnswer(sel, `{"replacement":"Shows ${EM} a status."}`)).toEqual({ sections: {}, replacement: 'Shows, a status.' });
    expect(parseDocsTaskAnswer(sel, 'Shows a status.')).toEqual({ sections: {}, replacement: 'Shows a status.' });
    expect(() => parseDocsTaskAnswer(sel, '{"replacement":""}')).toThrow(/no rewritten passage/);
    expect(() => parseDocsTaskAnswer({ kind: 'sections', keys: ['dos'] }, '{"summary":"x"}')).toThrow(/none of the sections/);
  });
});

describe('check sections (written text older than the code)', () => {
  const task = { kind: 'sections' as const, keys: ['summary', 'dos', 'accessibility'] as ('summary' | 'dos' | 'accessibility')[], check: ['summary', 'accessibility'] as ('summary' | 'accessibility')[] };

  it('an accurate checked section is omitted and reported as checked; a contradicted one comes back; the empty one is drafted', () => {
    const a = parseDocsTaskAnswer(task, JSON.stringify({ dos: [{ title: 'Short', text: 'One word.' }], accessibility: ['Announces the tone, not only its color.'] }));
    expect(a.sections).toEqual({ dos: [{ title: 'Short', text: 'One word.' }], accessibility: ['Announces the tone, not only its color.'] });
    expect(a.checked).toEqual(['summary']);
  });

  it('every checked section accurate: an empty answer is valid when only checks were asked', () => {
    const only = { kind: 'sections' as const, keys: ['summary'] as 'summary'[], check: ['summary'] as 'summary'[] };
    expect(parseDocsTaskAnswer(only, '{}')).toEqual({ sections: {}, checked: ['summary'] });
    expect(() => parseDocsTaskAnswer({ kind: 'sections', keys: ['dos'] }, '{}')).toThrow(/none of the sections/);
  });

  it('exchange results keep checked, and accept {"docs": {}} for all-accurate checks', () => {
    const item: DraftItem = { id: 'docs-1', scope: 'docs', component: 'Badge', changes: [], draft: { title: 'Badge docs', summary: 'Check' }, docs: { slug: 'badge', task, prompt: 'P' } };
    const p = composePendingDrafts({ items: [item], sessionId: 'check0001', source: 'studio', now: new Date('2026-10-17T09:00:00Z') });
    const out = mergeDraftResults(p, [{ id: 'docs-1', docs: { summary: 'Shows a status. Has no size prop anymore.' } }]);
    expect(out.results![0]).toMatchObject({ docs: { summary: 'Shows a status. Has no size prop anymore.' }, checked: ['accessibility'] });
    expect(draftItemBrief(item)).toMatch(/write the sections dos; check the sections summary, accessibility against the code and return one only when something in it is no longer true/);
    const onlyChecks: DraftItem = { ...item, docs: { slug: 'badge', task: { kind: 'sections', keys: ['summary'], check: ['summary'] }, prompt: 'P' } };
    const q = composePendingDrafts({ items: [onlyChecks], sessionId: 'check0002', source: 'studio' });
    expect(mergeDraftResults(q, [{ id: 'docs-1', docs: {} }]).results![0]).toMatchObject({ docs: {}, checked: ['summary'] });
  });
});

describe('review marks per section', () => {
  const base: ComponentDocsJson = { summary: 'S.', whenToUse: [], whenNotToUse: [], dos: [], donts: [], accessibility: [], anatomy: { root: 'Container' } };

  it('applyDocsSections replaces the sections and adds them to the ones waiting, in the repo order', () => {
    const one = applyDocsSections(base, { whenToUse: ['Next to a name.'] });
    expect(one).toMatchObject({ whenToUse: ['Next to a name.'], draftedBy: 'claude', needsReview: true, draftedSections: ['whenToUse'] });
    const two = applyDocsSections(one, { summary: 'New.' });
    expect(two.draftedSections).toEqual(['summary', 'whenToUse']);
    expect(sectionsNeedingReview(two)).toEqual(['summary', 'whenToUse']);
    expect(applyDocsSections(base, {})).toBe(base);
  });

  it('a whole-file draft has no draftedSections; accepting clears them', () => {
    const whole = markClaudeDraft({ ...base, draftedSections: ['summary'] } as ComponentDocsJson);
    expect(whole.draftedSections).toBeUndefined();
    expect(sectionsNeedingReview(whole)).toEqual([...PROSE_KEYS]);
    const accepted = acceptDocsDraft(applyDocsSections(base, { summary: 'New.' }));
    expect(accepted.draftedSections).toBeUndefined();
    expect(accepted.needsReview).toBe(false);
    expect(sectionsNeedingReview(accepted)).toEqual([]);
  });

  it('formatDocsJson writes draftedSections between draftedBy and needsReview', () => {
    const text = formatDocsJson({ needsReview: true, draftedSections: ['dos'], draftedBy: 'claude', ...base });
    expect(Object.keys(JSON.parse(text)).slice(-3)).toEqual(['draftedBy', 'draftedSections', 'needsReview']);
  });

  it('mergeDocsDraft (the Action) fills only empty sections, keeps anatomy and marks what it drafted', () => {
    const d = mergeDocsDraft(base, { summary: 'Invented.', whenToUse: [`Next ${EM} to a name.`], anatomy: { root: 'Changed' } });
    expect(d.summary).toBe('S.');
    expect(d.whenToUse).toEqual(['Next, to a name.']);
    expect(d.anatomy).toEqual({ root: 'Container' });
    expect(d).toMatchObject({ draftedBy: 'claude', needsReview: true, draftedSections: ['whenToUse'] });
  });
});

describe('Messages API request', () => {
  it('builds a browser call and an Action call, and reads the text', () => {
    const b = anthropicRequest({ apiKey: 'test-key', prompt: 'P', browser: true, system: 'S' });
    expect(b.url).toBe('https://api.anthropic.com/v1/messages');
    expect(b.init.headers).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    expect(JSON.parse(b.init.body)).toMatchObject({ model: 'claude-sonnet-5-5', system: 'S', messages: [{ role: 'user', content: 'P' }] });
    const a = anthropicRequest({ apiKey: 'k', prompt: 'P', fallback: true });
    expect(a.init.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(a.init.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
    expect(JSON.parse(a.init.body).fallbacks).toBe('default');
    expect(anthropicReplyText({ stop_reason: 'end_turn', content: [{ type: 'thinking' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab');
    expect(() => anthropicReplyText({ stop_reason: 'refusal' })).toThrow(/declined/);
    expect(() => anthropicReplyText({ stop_reason: 'max_tokens' })).toThrow(/cut off/);
  });
});

describe('docs items in the draft exchange', () => {
  const docsItem = (task: NonNullable<DraftItem['docs']>['task']): DraftItem => ({
    id: 'docs-1',
    scope: 'docs',
    component: 'Badge',
    changes: [],
    draft: { title: 'Badge docs', summary: 'Write dos' },
    docs: { slug: 'badge', path: 'packages/react/src/components/Badge/Badge.docs.json', task, prompt: 'THE PROMPT' },
  });
  const NOW = new Date('2026-10-17T09:00:00Z');

  it('validates docs items and the studio source', () => {
    const p = composePendingDrafts({ items: [docsItem({ kind: 'sections', keys: ['dos'] })], sessionId: 'docs00001', source: 'studio', now: NOW });
    expect(p.source).toBe('studio');
    expect(parsePendingDrafts(serializePendingDrafts(p))).toEqual(p);
    expect(validatePendingDrafts({ ...p, items: [{ ...p.items[0], docs: undefined }] })[0]).toMatch(/needs docs/);
    expect(validatePendingDrafts({ ...p, items: [{ ...p.items[0], docs: { ...p.items[0]!.docs, task: { kind: 'sections', keys: [] } } }] })[0]).toMatch(/no sections/);
    expect(validatePendingDrafts({ ...p, source: 'web' })).toContain('source must be "figma" or "studio".');
    expect(validatePendingDrafts({ ...p, items: [{ ...p.items[0], scope: 'request' }] })).toContain('Item 1: only a docs item has docs.');
  });

  it('the brief holds the task and the prompt', () => {
    expect(draftItemBrief(docsItem({ kind: 'sections', keys: ['dos', 'donts'], rewrite: true }))).toMatch(/^Item docs-1: component docs of Badge from Bridge Studio \(packages.*Badge\.docs\.json\): rewrite the sections dos, donts, answer with "docs"\.\n\nTHE PROMPT$/);
    expect(draftItemBrief(docsItem({ kind: 'selection', key: 'summary', text: 'x', mode: 'clearer' }))).toMatch(/rewrite one passage of the summary section \(clearer\), answer with "replacement"/);
  });

  it('results carry sanitized sections or a passage; wrong answers say what to send', () => {
    const p = composePendingDrafts({ items: [docsItem({ kind: 'sections', keys: ['dos'] })], sessionId: 'docs00001', source: 'studio', now: NOW });
    const out = mergeDraftResults(p, [{ id: 'docs-1', docs: { dos: [{ title: 'Short', text: `One ${EM} word.` }], summary: 'Not asked' } }], NOW);
    expect(out.status).toBe('drafted');
    expect(out.results).toEqual([{ id: 'docs-1', title: '', summary: '', docs: { dos: [{ title: 'Short', text: 'One, word.' }] }, checked: [], by: 'claude', at: NOW.toISOString() }]);
    expect(validatePendingDrafts(out)).toEqual([]);
    expect(() => mergeDraftResults(p, [{ id: 'docs-1', title: 'A title', summary: 'A summary' }])).toThrow(/asks for the sections dos: send \{"id": "docs-1", "docs": \{"dos": \.\.\.\}\}/);

    const s = composePendingDrafts({ items: [docsItem({ kind: 'selection', key: 'summary', text: 'Shows a status.', mode: 'shorter' })], sessionId: 'docs00002', source: 'studio', now: NOW });
    expect(mergeDraftResults(s, [{ id: 'docs-1', replacement: `"Status ${EM} short."` }], NOW).results![0]).toMatchObject({ replacement: 'Status, short.' });
    expect(() => mergeDraftResults(s, [{ id: 'docs-1', docs: {} }])).toThrow(/"replacement"/);
  });

  it('createDocsDraftSession starts the requests branch when missing and writes one studio session', async () => {
    const files = new Map<string, string>();
    const branches = new Map<string, string>([['main', 'abc']]);
    const client = {
      getBranchSha: async (b: string) => branches.get(b),
      createBranch: async (b: string, sha: string) => void branches.set(b, sha),
      getFile: async (path: string) => (files.has(path) ? { text: files.get(path)!, sha: 'x' } : undefined),
      putFile: async (i: { path: string; content: string; branch: string }) => {
        expect(i.branch).toBe(REQUESTS_BRANCH);
        files.set(i.path, i.content);
        return 'c1';
      },
      deleteFile: async () => 'c2',
      listDirectory: async () => [],
    };
    const p = await createDocsDraftSession(client, { component: 'Badge', slug: 'badge', task: { kind: 'sections', keys: ['summary'] }, prompt: 'P', baseBranch: 'main', now: NOW, random: () => 0.5 });
    expect(branches.get(REQUESTS_BRANCH)).toBe('abc');
    expect(p).toMatchObject({ source: 'studio', status: 'pending', items: [{ id: 'docs-1', scope: 'docs', docs: { slug: 'badge', prompt: 'P' } }] });
    expect(parsePendingDrafts(files.get(`.bridge/drafts/${p.sessionId}.json`))).toEqual(p);
    await ensureRequestsBranch(client, 'nope');
    branches.delete(REQUESTS_BRANCH);
    await expect(ensureRequestsBranch(client, 'nope')).rejects.toThrow(/"nope" was not found/);
  });

  it('DraftPoller (shared with the Figma plugin) resolves once the session is drafted', async () => {
    const p = composePendingDrafts({ items: [docsItem({ kind: 'sections', keys: ['dos'] })], sessionId: 'docs00003', source: 'studio', now: NOW });
    const drafted = mergeDraftResults(p, [{ id: 'docs-1', docs: { dos: [{ title: 'A', text: 'B.' }] } }], NOW);
    let reads = 0;
    const client = { getFile: async () => ({ text: serializePendingDrafts(++reads < 2 ? p : drafted), sha: 's' }) };
    const got: string[] = [];
    const poller = new DraftPoller({ client, sessionId: 'docs00003', onResults: (r) => got.push(JSON.stringify(r[0]!.docs)), onTimeout: () => got.push('timeout') });
    expect(await poller.check()).toBe(false);
    expect(await poller.check()).toBe(true);
    expect(got).toEqual(['{"dos":[{"title":"A","text":"B."}]}']);
  });
});
