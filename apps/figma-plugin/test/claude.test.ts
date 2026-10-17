// Writing help: the Messages API call built from the detected changes, answers parsed and cleaned, friendly errors,
// the "Copy for Claude" prompt, and where the API key may go (client storage and api.anthropic.com, nowhere else).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLAUDE_API_URL,
  ClaudeDraftError,
  DEFAULT_CLAUDE_MODEL,
  type ClaudeDraftInput,
  SYSTEM_PROMPT,
  TITLE_MAX,
  buildClaudeRequest,
  claudeErrorMessage,
  copyPrompt,
  draftWithClaude,
  parseClaudeAnswer,
  sanitizeDraft,
} from '../src/sync/claude';
import { CLAUDE_KEY, CLAUDE_MODEL_KEY, clearClaudeKey, readClaudeSettings, saveClaudeSettings } from '../src/main/claude-settings';
import { type ComponentChangeItem, buildSignature, toRequest } from '../src/sync/components';
import { componentDrafts } from '../src/sync/publish';
import { SimFigma } from './figma-api';

const EM = '\u2014';
const KEY = 'sk-ant-api03-test-key-not-real-0123456789';

const input: ClaudeDraftInput = {
  target: 'request',
  component: 'Badge',
  kind: 'new-variant',
  changes: [{ field: 'Variant Tone', before: 'info, neutral', after: 'danger, info, neutral' }],
  draft: { title: 'Add a danger tone', summary: 'Badge gets a new Tone value, danger.' },
  notes: 'For destructive states in tables.',
  before: 'QkVGT1JF',
  after: 'data:image/png;base64,QUZURVI=',
};

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };

function mockFetch(reply: { status?: number; body?: unknown; throws?: boolean }) {
  const calls: Call[] = [];
  const fn = async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    if (reply.throws) throw new TypeError('Failed to fetch');
    const status = reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => reply.body };
  };
  return { fn, calls };
}

const answer = (text: string) => ({ body: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] } });

test('builds a direct browser call to the Messages API with the change table and both images', () => {
  const req = buildClaudeRequest(KEY, 'claude-opus-5-5', input);
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.init.method, 'POST');
  assert.deepEqual(req.init.headers, {
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
  });
  const body = JSON.parse(req.init.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.system, SYSTEM_PROMPT);
  const content = body.messages[0].content as { type: string; text?: string; source?: { type: string; media_type: string; data: string } }[];
  const images = content.filter((c) => c.type === 'image');
  assert.deepEqual(images.map((c) => c.source), [
    { type: 'base64', media_type: 'image/png', data: 'QkVGT1JF' },
    { type: 'base64', media_type: 'image/png', data: 'QUZURVI=' },
  ]);
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  assert.match(text, /Component: Badge/);
  assert.match(text, /Kind: New variant/);
  assert.match(text, /\| Variant Tone \| info, neutral \| danger, info, neutral \|/);
  assert.match(text, /For destructive states in tables\./);
  // The key only travels in the header.
  assert.ok(!req.init.body.includes(KEY));
});

test('defaults to Sonnet, skips missing images, and keeps the voice rules in the system prompt', () => {
  const req = buildClaudeRequest(KEY, 'gpt-something', { ...input, before: undefined, after: undefined });
  const body = JSON.parse(req.init.body);
  assert.equal(body.model, DEFAULT_CLAUDE_MODEL);
  assert.equal(DEFAULT_CLAUDE_MODEL, 'claude-sonnet-5-5');
  assert.ok(!body.messages[0].content.some((c: { type: string }) => c.type === 'image'));
  assert.match(SYSTEM_PROMPT, /Never use an em dash/);
  assert.match(SYSTEM_PROMPT, /Never invent numbers/);
  assert.match(SYSTEM_PROMPT, /\{"title": "\.\.\.", "summary": "\.\.\.", "lines": \[\{"id": "\.\.\.", "line": "\.\.\."\}\]\}/);
  assert.ok(!SYSTEM_PROMPT.includes(EM));
});

test('parses answers: plain JSON, fenced JSON, JSON inside text; rejects invalid ones', () => {
  const want = { title: 'Add a danger tone', summary: 'Badge gets a danger tone for destructive states.' };
  assert.deepEqual(parseClaudeAnswer(JSON.stringify(want)), want);
  assert.deepEqual(parseClaudeAnswer('```json\n' + JSON.stringify(want) + '\n```'), want);
  assert.deepEqual(parseClaudeAnswer(`Here is the draft:\n${JSON.stringify(want)}\nLet me know.`), want);
  assert.throws(() => parseClaudeAnswer('Sure, I can help with that.'), ClaudeDraftError);
  assert.throws(() => parseClaudeAnswer('{"title": "Add", "summary": }'), /not valid JSON/);
  assert.throws(() => parseClaudeAnswer('{"foo": 1}'), /no title and summary/);
});

test('sanitizes: no em dash, a title of at most 70 characters, at most 3 sentences', () => {
  const d = sanitizeDraft({
    title: `Add a danger tone ${EM} for destructive actions in dense tables and settings pages across the product.`,
    summary: `One ${EM} two. Second sentence. Third sentence. Fourth sentence.`,
  });
  assert.ok(!d.title.includes(EM) && !d.summary.includes(EM));
  assert.ok(d.title.length <= TITLE_MAX, d.title);
  assert.ok(!d.title.endsWith('.'));
  assert.equal(d.summary, 'One, two. Second sentence. Third sentence.');
});

test('draftWithClaude calls api.anthropic.com only and returns the cleaned draft', async () => {
  const m = mockFetch(answer(`{"title": "Add a danger tone", "summary": "Badge gets a danger tone ${EM} for destructive states."}`));
  const d = await draftWithClaude(m.fn, KEY, 'claude-haiku-5-5', input);
  assert.deepEqual(d, { title: 'Add a danger tone', summary: 'Badge gets a danger tone, for destructive states.' });
  assert.equal(m.calls.length, 1);
  for (const c of m.calls) assert.ok(c.url.startsWith('https://api.anthropic.com/'), c.url);
  assert.equal(m.calls[0]!.url, CLAUDE_API_URL);
  assert.equal(JSON.parse(m.calls[0]!.init.body).model, 'claude-haiku-5-5');
});

test('maps errors to messages that say what to do', async () => {
  for (const [status, re] of [
    [401, /did not accept the API key/],
    [429, /rate limiting/],
    [529, /busy/],
    [400, /could not read this request/],
  ] as const) {
    const m = mockFetch({ status, body: { type: 'error' } });
    await assert.rejects(draftWithClaude(m.fn, KEY, DEFAULT_CLAUDE_MODEL, input), (e: unknown) => e instanceof ClaudeDraftError && re.test(e.message) && e.status === status);
  }
  await assert.rejects(draftWithClaude(mockFetch({ throws: true }).fn, KEY, DEFAULT_CLAUDE_MODEL, input), /Could not reach Claude/);
  await assert.rejects(draftWithClaude(mockFetch({ body: { stop_reason: 'refusal', content: [] } }).fn, KEY, DEFAULT_CLAUDE_MODEL, input), /declined/);
  const none = mockFetch(answer('{}'));
  await assert.rejects(draftWithClaude(none.fn, '  ', DEFAULT_CLAUDE_MODEL, input), /Add an Anthropic API key/);
  assert.equal(none.calls.length, 0);
  for (const s of [401, 403, 429, 500, 'network'] as const) assert.ok(!claudeErrorMessage(s).includes(EM));
});

test('Copy for Claude: one prompt with the voice rules, the change table and what to return, no images, no key', () => {
  const p = copyPrompt(input);
  assert.ok(p.startsWith(SYSTEM_PROMPT));
  assert.match(p, /\| What \| Now \| In Figma \|/);
  assert.match(p, /\| Variant Tone \| info, neutral \| danger, info, neutral \|/);
  assert.match(p, /Starting draft/);
  assert.match(p, /attach before and after screenshots/);
  assert.match(p, /Answer with the JSON object only\./);
  assert.ok(!p.includes('QkVGT1JF') && !p.includes('Images attached'));
  assert.ok(!p.includes(EM));
  const push = copyPrompt({ target: 'push', changes: [{ field: 'color.action.primary.bg', before: '#0b4a8b', after: '#043e70' }], components: ['Button'] });
  assert.match(push, /pull request with these design token/);
  assert.match(push, /Components with a change request: Button/);
});

test('the API key lives in client storage only: never in the file, cleared on remove', async () => {
  const sim = new SimFigma();
  const store = new Map<string, unknown>();
  const api = sim.api() as Record<string, unknown>;
  api.clientStorage = {
    getAsync: async (k: string) => store.get(k),
    setAsync: async (k: string, v: unknown) => void store.set(k, v),
    deleteAsync: async (k: string) => void store.delete(k),
  };
  (globalThis as unknown as { figma: unknown }).figma = api;
  const writes: string[] = [];
  // Every way to write into the file records what it writes.
  const root = sim.root as unknown as Record<string, unknown>;
  for (const name of ['setSharedPluginData', 'setPluginData']) {
    const original = root[name] as ((...a: string[]) => void) | undefined;
    root[name] = (...a: string[]) => {
      writes.push(a[a.length - 1]!);
      original?.apply(root, a);
    };
  }

  assert.deepEqual(await readClaudeSettings(), { hasKey: false, key: undefined, model: 'claude-sonnet-5-5' });
  await assert.rejects(saveClaudeSettings({ key: 'not-a-key' }), /start with sk-ant-/);
  assert.deepEqual(await saveClaudeSettings({ key: `  ${KEY}  `, model: 'claude-opus-5-5' }), { hasKey: true, model: 'claude-opus-5-5' });
  assert.equal(store.get(CLAUDE_KEY), KEY);
  assert.equal(store.get(CLAUDE_MODEL_KEY), 'claude-opus-5-5');
  // An empty key keeps the saved one; a model change alone is fine.
  await saveClaudeSettings({ key: '', model: 'claude-haiku-5-5' });
  assert.equal((await readClaudeSettings()).key, KEY);
  await assert.rejects(saveClaudeSettings({ model: 'gpt-4' }), /listed Claude models/);
  assert.ok(!writes.some((v) => v.includes(KEY)), 'the key was written into the file');
  await clearClaudeKey();
  assert.equal((await readClaudeSettings()).hasKey, false);
});

test('push requests get their own drafted summary while the description is the plugin draft', () => {
  const signature = buildSignature({ nodeId: '1:1', name: 'Badge', definitions: [], variants: [] });
  const item: ComponentChangeItem = { nodeId: '1:1', component: 'Badge', figmaName: 'Badge', kind: 'new-variant', changes: [{ field: 'Variant Tone', before: 'info', after: 'danger, info' }], signature };
  const drafted = componentDrafts([item], new Set(), 'Changes color.a.', 'Library', true);
  assert.equal(drafted[0]!.title, 'Add a danger tone');
  assert.equal(drafted[0]!.summary, 'Badge gets a new Tone value, danger.');
  const typed = componentDrafts([item], new Set(), 'Destructive states need it.', 'Library', false);
  assert.equal(typed[0]!.summary, 'Destructive states need it.');
  // Each request opens with its change line: Claude's when it wrote one, else the drafted one.
  assert.equal(drafted[0]!.line, 'Danger added to Tone');
  assert.equal(componentDrafts([item], new Set(), '', 'Library', true, new Map([['1:1', 'Danger tone added for destructive states']]))[0]!.line, 'Danger tone added for destructive states');
  assert.equal(toRequest(drafted[0]!, {}).line, 'Danger added to Tone');
});

test('change lines: listed by id in the prompt, images per line attached, answers sanitized, old answers still parse', () => {
  const withLines: ClaudeDraftInput = {
    target: 'push',
    changes: [],
    components: ['Button'],
    lines: [{ id: '12:34', component: 'Button', kind: 'visual', changes: [{ field: 'Look of Size=sm', before: 'As in the baseline', after: 'Changed in Figma, no variable explains it' }], line: 'Looks different in Size=sm; no variable explains it' }],
    lineImages: [{ id: '12:34', before: 'QkVGT1JF', after: 'QUZURVI=' }],
  };
  const req = buildClaudeRequest(KEY, DEFAULT_CLAUDE_MODEL, withLines);
  const body = JSON.parse(req.init.body);
  const content = body.messages[0].content as { type: string; text?: string }[];
  assert.ok(content.some((c) => c.text === 'Line 12:34, before (baseline):'));
  assert.equal(content.filter((c) => c.type === 'image').length, 2);
  const text = content[content.length - 1]!.text!;
  assert.match(text, /- id 12:34, Button \(Visual change\)\. Starting line: Looks different in Size=sm/);
  assert.match(text, /Look of Size=sm: As in the baseline -> Changed in Figma/);
  const d = parseClaudeAnswer(`{"title": "Add an icon", "summary": "Shows an icon.", "lines": [{"id": "12:34", "line": "Icon added ${EM} primary sm: Pencil, 16px."}, {"id": "", "line": "x"}]}`);
  assert.deepEqual(d.lines, [{ id: '12:34', line: 'Icon added, primary sm: Pencil, 16px' }]);
  assert.equal(parseClaudeAnswer('{"title": "Add an icon", "summary": "Shows an icon."}').lines, undefined);
  assert.deepEqual(sanitizeDraft({ lines: [{ id: 'a', line: 'Only a line' }] }), { title: '', summary: '', lines: [{ id: 'a', line: 'Only a line' }] });
  assert.doesNotMatch(copyPrompt(withLines), /QkVGT1JF/);
});
