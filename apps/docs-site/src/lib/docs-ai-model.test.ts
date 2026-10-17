import { describe, expect, it } from 'vitest';
import { PROSE_KEYS, type ComponentDocsJson } from '@bridge-ds/core';
import { availability, docsApiRequest, isEmptyTask, outdatedFromDates, resultFromExchange, resultFromReply, scopeTask, taskPrompt, type DocsAiContext } from './docs-ai-model';

const EM = '\u2014';

const full: ComponentDocsJson = {
  summary: 'Shows a short status next to a name.',
  whenToUse: ['Next to a name.'],
  whenNotToUse: ['For actions.'],
  dos: [{ title: 'Keep it short', text: 'One or two words.' }],
  donts: [{ title: 'No sentences', text: 'Use a callout.' }],
  accessibility: ['Color is never the only signal.'],
  contentGuidelines: ['Sentence case.'],
  anatomy: { root: 'Container' },
};

const ctx: DocsAiContext = {
  slug: 'badge',
  name: 'Badge',
  files: { tsx: 'packages/react/src/components/Badge/Badge.tsx', css: 'packages/react/src/components/Badge/Badge.module.css', docs: 'packages/react/src/components/Badge/Badge.docs.json' },
  input: { name: 'Badge', description: 'Short status label.', props: [{ name: 'tone', type: "'info' | 'danger'", required: false, defaultValue: "'info'" }], tokens: ['--color-text-default'], cssClasses: ['root', 'danger'] },
  conventions: { voice: 'Sentence case.', source: 'export const Badge = () => null;', styles: '.root { color: var(--color-text-default); }' },
};

const reply = (text: string, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text }] });

describe('availability', () => {
  it('lists the open ways, the API key first', () => {
    expect(availability({ apiKey: false, exchange: false })).toEqual({ ways: [], preferred: null });
    expect(availability({ apiKey: false, exchange: true })).toEqual({ ways: ['my-claude'], preferred: 'my-claude' });
    expect(availability({ apiKey: true, exchange: true })).toEqual({ ways: ['api-key', 'my-claude'], preferred: 'api-key' });
  });
});

describe('scope selection', () => {
  it('page-fill skips reviewed, non-empty, up-to-date sections', () => {
    const docs = { ...full, whenNotToUse: [], contentGuidelines: undefined };
    const t = scopeTask({ kind: 'page-fill' }, docs);
    expect(t).toEqual({ kind: 'sections', keys: ['whenNotToUse', 'contentGuidelines'] });
  });

  it('page-fill also takes outdated sections, flagged for an update', () => {
    const t = scopeTask({ kind: 'page-fill' }, { ...full, whenNotToUse: [] }, ['summary', 'whenNotToUse']);
    expect(t).toEqual({ kind: 'sections', keys: ['summary', 'whenNotToUse'], outdated: ['summary'] });
  });

  it('page-fill on complete, up-to-date docs has nothing to draft', () => {
    const t = scopeTask({ kind: 'page-fill' }, full, []);
    expect(isEmptyTask(t)).toBe(true);
  });

  it('page-rewrite takes every prose section, never anatomy', () => {
    expect(scopeTask({ kind: 'page-rewrite' }, full)).toEqual({ kind: 'sections', keys: [...PROSE_KEYS], rewrite: true });
  });

  it('section: one key, rewritten when it holds text; anatomy is refused', () => {
    expect(scopeTask({ kind: 'section', key: 'dos' }, full)).toEqual({ kind: 'sections', keys: ['dos'], rewrite: true });
    expect(scopeTask({ kind: 'section', key: 'dos' }, { ...full, dos: [] })).toEqual({ kind: 'sections', keys: ['dos'] });
    expect(() => scopeTask({ kind: 'section', key: 'anatomy' as never }, full)).toThrow(/code/);
  });

  it('selection keeps the passage and the mode, and needs text', () => {
    expect(scopeTask({ kind: 'selection', key: 'summary', text: ' Shows a status. ', mode: 'shorter' }, full)).toEqual({ kind: 'selection', key: 'summary', text: 'Shows a status.', mode: 'shorter' });
    expect(() => scopeTask({ kind: 'selection', key: 'summary', text: ' ', mode: 'voice' }, full)).toThrow(/Select/);
  });
});

describe('outdated sections', () => {
  it('every written section is outdated when the code moved after docs.json', () => {
    const docs = { ...full, dos: [] };
    expect(outdatedFromDates(docs, { code: ['2026-10-10T00:00:00Z', '2026-10-01T00:00:00Z'], docs: '2026-10-05T00:00:00Z' })).toEqual([...PROSE_KEYS]);
    expect(outdatedFromDates(docs, { code: ['2026-10-01T00:00:00Z', null], docs: '2026-10-05T00:00:00Z' })).toEqual(['dos']);
  });

  it('empty-only when GitHub could not be read, all when docs.json was never committed', () => {
    expect(outdatedFromDates({ ...full, summary: '' }, null)).toEqual(['summary']);
    expect(outdatedFromDates(full, { code: ['2026-10-01T00:00:00Z'], docs: null })).toEqual([...PROSE_KEYS]);
    expect(outdatedFromDates(full, { code: [null, null], docs: null })).toEqual([]);
  });
});

describe('prompt', () => {
  it('asks only for the task keys, with the facts from the code and the current text', () => {
    const p = taskPrompt(ctx, full, { kind: 'sections', keys: ['dos', 'donts'], rewrite: true });
    expect(p).toMatch(/Rewrite these sections of Badge\.docs\.json for the Bridge design system: dos, donts\./);
    expect(p).toMatch(/Write only these keys: dos, donts\. Never return anatomy/);
    expect(p).toContain('"dos": [{ "title": "...", "text": "..." }]');
    expect(p).toContain('| `tone` |');
    expect(p).toContain('<styles>');
    expect(p).toContain('Shows a short status next to a name.');
    expect(p).not.toContain(EM);
  });

  it('a selection prompt quotes the passage and asks for a replacement', () => {
    const p = taskPrompt(ctx, full, { kind: 'selection', key: 'summary', text: 'Shows a short status.', mode: 'clearer' });
    expect(p).toMatch(/Rewrite one passage of the "summary" section/);
    expect(p).toContain('<passage>\nShows a short status.\n</passage>');
    expect(p).toContain('{ "replacement": "the rewritten passage" }');
    expect(p).toContain('Facts computed from the code:');
  });
});

describe('direct API call', () => {
  it('goes to api.anthropic.com with the browser header and the default model', () => {
    const req = docsApiRequest('sk-test-not-a-key', 'PROMPT');
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(req.init.headers['x-api-key']).toBe('sk-test-not-a-key');
    const body = JSON.parse(req.init.body);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.messages).toEqual([{ role: 'user', content: 'PROMPT' }]);
    expect(body.system).toMatch(/Never use an em dash/);
  });
});

describe('answers', () => {
  const sections = { kind: 'sections' as const, keys: ['summary', 'dos'] as ('summary' | 'dos')[] };

  it('parses fenced JSON, keeps only the asked keys, strips em dashes and broken items', () => {
    const text = `Here you go:\n\`\`\`json\n${JSON.stringify({ summary: `Shows a status ${EM} next to a name.`, dos: [{ title: 'Keep it short', text: `One word ${EM} two at most.` }, { title: 'Empty' }], anatomy: { root: 'Invented' }, whenToUse: ['Not asked'] })}\n\`\`\``;
    const r = resultFromReply(sections, reply(text));
    expect(r).toEqual({ sections: { summary: 'Shows a status, next to a name.', dos: [{ title: 'Keep it short', text: 'One word, two at most.' }] } });
    expect(JSON.stringify(r)).not.toContain(EM);
  });

  it('a selection returns the replacement only', () => {
    const task = { kind: 'selection' as const, key: 'summary' as const, text: 'Shows a short status.', mode: 'voice' as const };
    expect(resultFromReply(task, reply(`{"replacement": "Shows a status ${EM} briefly.", "summary": "ignored"}`))).toEqual({ sections: {}, replacement: 'Shows a status, briefly.' });
    expect(resultFromReply(task, reply('"Short status label."'))).toEqual({ sections: {}, replacement: 'Short status label.' });
  });

  it('fails with a sentence when Claude declined or sent none of the sections', () => {
    expect(() => resultFromReply(sections, reply('{"whenToUse": ["x"]}'))).toThrow(/none of the sections/);
    expect(() => resultFromReply(sections, reply('', 'refusal'))).toThrow(/declined/);
    expect(() => resultFromReply(sections, reply('I cannot help.'))).toThrow(/no JSON/);
  });

  it('exchange results are sanitized the same way', () => {
    expect(resultFromExchange(sections, { docs: { summary: `A ${EM} B` } })).toEqual({ sections: { summary: 'A, B' } });
    const sel = { kind: 'selection' as const, key: 'summary' as const, text: 'x', mode: 'shorter' as const };
    expect(resultFromExchange(sel, { replacement: 'Shorter.' })).toEqual({ sections: {}, replacement: 'Shorter.' });
    expect(() => resultFromExchange(sel, {})).toThrow(/no rewritten passage/);
  });
});
