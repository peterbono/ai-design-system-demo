// Reading a deployed (or built) Storybook: its index, grouped into components, and the URLs that show a story.
// Pure parsing plus one fetch helper over an injected fetch. No DOM, no Node APIs.
//
// Index formats:
//   index.json, v4 (Storybook 7) and v5 (8+): { v, entries: { [id]: { id, title, name, type, importPath, tags?, subtype?, exportName?, componentPath? } } }
//   stories.json, v3 (6.4/6.5 with buildStoriesJson, still emitted by some 7 builds):
//     { v, stories: { [id]: { id, title?, kind, name?, story, importPath, parameters?: { docsOnly? } } } }

/** One index entry, normalised across versions. */
export interface StorybookEntry {
  id: string;
  /** Sidebar path, `/`-separated ("Forms/Button"). */
  title: string;
  /** Story or docs page name ("Primary", "Docs"). */
  name: string;
  type: 'story' | 'docs';
  /** Storybook 9+ marks test entries `test`; stories are `story`. Absent before. */
  subtype?: string;
  importPath: string;
  tags: string[];
  exportName?: string;
  componentPath?: string;
}

/** Entries that share a title: one component (or one docs-only page such as "Intro"). */
export interface StorybookComponent {
  title: string;
  /** Last segment of the title ("Button" for "Forms/Button"). */
  name: string;
  /** Segments before the name (["Forms"]); empty at the root. */
  group: string[];
  /** Story entries in index order (test entries excluded). */
  stories: StorybookEntry[];
  docs: StorybookEntry[];
  /** Union of the entries' tags, sorted. */
  tags: string[];
}

export type StorybookIndexSource = 'index.json' | 'stories.json';

export interface StorybookIndex {
  /** The index's `v` field. */
  version: number;
  source: StorybookIndexSource;
  entries: StorybookEntry[];
  /** Grouped by title, sorted by title. */
  components: StorybookComponent[];
}

export type StorybookErrorCode = 'invalid-url' | 'not-found' | 'not-json' | 'private' | 'empty' | 'http' | 'network';

export class StorybookIndexError extends Error {
  constructor(
    readonly code: StorybookErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'StorybookIndexError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

function entryFrom(key: string, raw: unknown, v3: boolean): StorybookEntry | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id) ?? key;
  const title = str(raw.title) ?? str(raw.kind);
  const name = str(raw.name) ?? str(raw.story);
  if (!id || !title || !name) return null;
  const params = isObj(raw.parameters) ? raw.parameters : {};
  const type: 'story' | 'docs' = raw.type === 'docs' || raw.type === 'story' ? raw.type : v3 && params.docsOnly === true ? 'docs' : 'story';
  const e: StorybookEntry = {
    id,
    title,
    name,
    type,
    importPath: str(raw.importPath) ?? str(params.fileName) ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
  };
  const subtype = str(raw.subtype);
  if (subtype) e.subtype = subtype;
  const exportName = str(raw.exportName);
  if (exportName) e.exportName = exportName;
  const componentPath = str(raw.componentPath);
  if (componentPath) e.componentPath = componentPath;
  return e;
}

/** Groups entries by title. Test entries (subtype `test`) stay out of `stories`. */
export function groupStorybookComponents(entries: StorybookEntry[]): StorybookComponent[] {
  const byTitle = new Map<string, StorybookComponent>();
  for (const e of entries) {
    let c = byTitle.get(e.title);
    if (!c) {
      const parts = e.title.split('/').map((p) => p.trim()).filter(Boolean);
      c = { title: e.title, name: parts[parts.length - 1] ?? e.title, group: parts.slice(0, -1), stories: [], docs: [], tags: [] };
      byTitle.set(e.title, c);
    }
    if (e.type === 'docs') c.docs.push(e);
    else if (e.subtype !== 'test') c.stories.push(e);
    for (const t of e.tags) if (!c.tags.includes(t)) c.tags.push(t);
  }
  const out = [...byTitle.values()].filter((c) => c.stories.length || c.docs.length);
  for (const c of out) c.tags.sort();
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Parses an `index.json` (v4, v5) or `stories.json` (v3) body. Throws StorybookIndexError: `private` for a
 * Chromatic login answer, `empty` when the body has no readable entries.
 */
export function parseStorybookIndex(json: unknown, source?: StorybookIndexSource): StorybookIndex {
  if (!isObj(json)) throw new StorybookIndexError('not-json', 'The Storybook index is not a JSON object.');
  if (typeof json.loginUrl === 'string' && !('entries' in json) && !('stories' in json)) {
    throw new StorybookIndexError('private', 'This Storybook is private: it asks for a sign-in before showing its index.');
  }
  const map = isObj(json.entries) ? json.entries : isObj(json.stories) ? json.stories : null;
  if (!map) throw new StorybookIndexError('empty', 'This file has no Storybook entries.');
  const v3 = !isObj(json.entries);
  const entries = Object.entries(map)
    .map(([k, raw]) => entryFrom(k, raw, v3))
    .filter((e): e is StorybookEntry => e !== null);
  if (!entries.length) throw new StorybookIndexError('empty', 'This Storybook index lists no stories or docs.');
  const version = typeof json.v === 'number' ? json.v : v3 ? 3 : 4;
  return { version, source: source ?? (v3 ? 'stories.json' : 'index.json'), entries, components: groupStorybookComponents(entries) };
}

/**
 * The base address of a Storybook from what a person pastes: trims, drops the query and hash
 * (`?path=/story/...`), a trailing `index.html` / `iframe.html` / `index.json` / `stories.json`, and trailing slashes.
 * Throws `invalid-url` unless it is http(s); https is required except on localhost.
 */
export function normalizeStorybookUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new StorybookIndexError('invalid-url', 'Enter the full Storybook address, for example https://storybook.example.com');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new StorybookIndexError('invalid-url', 'The Storybook address must start with https://');
  }
  if (u.username || u.password) throw new StorybookIndexError('invalid-url', 'Remove the user name and password from the address.');
  const path = u.pathname.replace(/\/(index\.html|iframe\.html|index\.json|stories\.json)$/i, '/').replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

/** The index files to try, in order. */
export const storybookIndexUrls = (base: string): { url: string; source: StorybookIndexSource }[] => {
  const b = base.replace(/\/+$/, '');
  return [
    { url: `${b}/index.json`, source: 'index.json' },
    { url: `${b}/stories.json`, source: 'stories.json' },
  ];
};

export interface StorybookIframeOptions {
  /** `story` (default) or `docs`. */
  viewMode?: 'story' | 'docs';
  /** Toolbar globals (`globals=brand:ocean;theme:dark`), in insertion order. */
  globals?: Record<string, string>;
  /** Story args (`args=label:Save`). */
  args?: Record<string, string>;
}

// Storybook reads `key:value;key:value`; keep the separators literal and encode the rest.
const pairs = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}:${encodeURIComponent(v)}`)
    .join(';');

/** URL of one story (or docs page) rendered alone: `<base>/iframe.html?id=<id>&viewMode=story[&globals=..][&args=..]`. */
export function storybookIframeUrl(base: string, id: string, o: StorybookIframeOptions = {}): string {
  let url = `${base.replace(/\/+$/, '')}/iframe.html?id=${encodeURIComponent(id)}&viewMode=${o.viewMode ?? 'story'}`;
  if (o.globals && Object.keys(o.globals).length) url += `&globals=${pairs(o.globals)}`;
  if (o.args && Object.keys(o.args).length) url += `&args=${pairs(o.args)}`;
  return url;
}

/** URL of a story or docs page in the full Storybook UI (sidebar and toolbar). */
export function storybookManagerUrl(base: string, id: string, viewMode: 'story' | 'docs' = 'story'): string {
  return `${base.replace(/\/+$/, '')}/?path=/${viewMode}/${encodeURIComponent(id)}`;
}

export type StorybookFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface FetchStorybookIndexOptions {
  fetch?: StorybookFetch;
  signal?: AbortSignal;
}

/**
 * Reads a Storybook's index: `index.json`, then `stories.json`. A 404, an HTML answer (static hosts that fall back
 * to index.html) or a body without entries moves on to the next file; the first readable index wins. Throws
 * StorybookIndexError with the most telling failure (`private` before `not-json` before `not-found`).
 */
export async function fetchStorybookIndex(base: string, o: FetchStorybookIndexOptions = {}): Promise<StorybookIndex> {
  const doFetch: StorybookFetch = o.fetch ?? ((url, init) => fetch(url, init));
  const rank: Record<StorybookErrorCode, number> = { private: 6, http: 5, network: 4, empty: 3, 'not-json': 2, 'not-found': 1, 'invalid-url': 0 };
  let worst: StorybookIndexError | null = null;
  const keep = (e: StorybookIndexError) => {
    if (!worst || rank[e.code] > rank[worst.code]) worst = e;
  };
  for (const { url, source } of storybookIndexUrls(base)) {
    let res: Awaited<ReturnType<StorybookFetch>>;
    try {
      res = await doFetch(url, { headers: { accept: 'application/json' }, ...(o.signal ? { signal: o.signal } : {}) });
    } catch (err) {
      if (o.signal?.aborted) throw err;
      keep(new StorybookIndexError('network', `Could not reach ${url}. The host may be down or may not allow reading from another site.`));
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      keep(new StorybookIndexError('not-found', `No Storybook index at ${base}: neither index.json nor stories.json was found.`, res.status));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      keep(new StorybookIndexError('private', 'This Storybook is private: it asks for a sign-in before showing its index.', res.status));
      continue;
    }
    if (!res.ok) {
      keep(new StorybookIndexError('http', `The Storybook host answered ${res.status} for ${url}.`, res.status));
      continue;
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      keep(new StorybookIndexError('not-json', `${url} is not a Storybook index (the host answered with a web page).`));
      continue;
    }
    try {
      return parseStorybookIndex(json, source);
    } catch (err) {
      if (err instanceof StorybookIndexError) keep(err);
      else throw err;
    }
  }
  throw worst ?? new StorybookIndexError('not-found', `No Storybook index at ${base}.`);
}
