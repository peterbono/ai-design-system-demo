// Build the logical token set (one entry per token, values per mode) from the repo's DTCG files.

import { type TokenDocument, flattenTokens, parseTokenFile } from './dtcg-codec';
import { EXT_ID, EXT_SCOPES, type LogicalToken, PRIMITIVE_MODE, type RepoLayout, type TokenMap } from './types';

export interface TokenSet {
  tokens: TokenMap;
  byPath: Map<string, LogicalToken>;
  docs: Map<string, TokenDocument>;
  layout: RepoLayout;
  /** Problems found while reading (duplicate paths, missing types, parse errors). */
  problems: string[];
}

export const isTokenFile = (file: string) => file.endsWith('.tokens.json');

/** Default id of a token that does not declare `com.dsbridge.id`. */
export const pathId = (path: string) => `path:${path}`;

const MODE_ORDER = ['light', 'dark'];

export function detectLayout(files: string[]): RepoLayout {
  const tokenFiles = files.filter(isTokenFile).sort();
  const themes = tokenFiles
    .filter((f) => f.startsWith('semantic/'))
    .map((file) => ({ file, mode: file.slice(file.lastIndexOf('/') + 1).replace(/\.tokens\.json$/, '') }))
    .sort((a, b) => {
      const ia = MODE_ORDER.indexOf(a.mode);
      const ib = MODE_ORDER.indexOf(b.mode);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.mode.localeCompare(b.mode);
    });
  return { primitiveFiles: tokenFiles.filter((f) => !f.startsWith('semantic/')), themes };
}

function readScopes(ext: Record<string, unknown> | undefined): string[] | undefined {
  const s = ext?.[EXT_SCOPES];
  return Array.isArray(s) && s.every((x) => typeof x === 'string') ? (s as string[]) : undefined;
}

function readId(ext: Record<string, unknown> | undefined): string | undefined {
  const id = ext?.[EXT_ID];
  return typeof id === 'string' && id ? id : undefined;
}

/** `files` maps paths relative to the tokens directory to file contents. */
export function buildTokenSet(files: Record<string, string>): TokenSet {
  const problems: string[] = [];
  const docs = new Map<string, TokenDocument>();
  for (const [file, text] of Object.entries(files)) {
    if (!isTokenFile(file)) continue;
    try {
      docs.set(file, parseTokenFile(file, text));
    } catch (err) {
      problems.push(`${file} is not valid JSON: ${(err as Error).message}`);
    }
  }
  const layout = detectLayout([...docs.keys()]);
  const tokens: TokenMap = new Map();
  const byPath = new Map<string, LogicalToken>();

  const add = (t: LogicalToken) => {
    if (tokens.has(t.id)) {
      problems.push(`Two tokens share the id "${t.id}" (${tokens.get(t.id)!.path} and ${t.path}).`);
      return;
    }
    tokens.set(t.id, t);
    byPath.set(t.path, t);
  };

  for (const file of layout.primitiveFiles) {
    for (const flat of flattenTokens(docs.get(file)!)) {
      if (byPath.has(flat.path)) {
        problems.push(`${flat.path} is defined twice (${byPath.get(flat.path)!.files[PRIMITIVE_MODE]} and ${file}).`);
        continue;
      }
      if (!flat.type) problems.push(`${flat.path} in ${file} has no $type.`);
      add({
        id: readId(flat.extensions) ?? pathId(flat.path),
        path: flat.path,
        type: flat.type ?? 'unknown',
        tier: 'primitive',
        values: { [PRIMITIVE_MODE]: flat.value },
        description: flat.description,
        scopes: readScopes(flat.extensions),
        files: { [PRIMITIVE_MODE]: file },
      });
    }
  }

  const semantic = new Map<string, LogicalToken>();
  for (const { mode, file } of layout.themes) {
    for (const flat of flattenTokens(docs.get(file)!)) {
      let t = semantic.get(flat.path);
      if (!t) {
        if (byPath.has(flat.path)) {
          problems.push(`${flat.path} exists both as a primitive and as a semantic token.`);
          continue;
        }
        t = {
          id: readId(flat.extensions) ?? pathId(flat.path),
          path: flat.path,
          type: flat.type ?? 'unknown',
          tier: 'semantic',
          values: {},
          description: flat.description,
          scopes: readScopes(flat.extensions),
          files: {},
        };
        semantic.set(flat.path, t);
        if (!flat.type) problems.push(`${flat.path} in ${file} has no $type.`);
      } else if (flat.type && t.type !== flat.type) {
        problems.push(`${flat.path} has type ${t.type} in one theme and ${flat.type} in ${file}.`);
      }
      t.values[mode] = flat.value;
      t.files[mode] = file;
      t.description ??= flat.description;
      t.scopes ??= readScopes(flat.extensions);
    }
  }
  semantic.forEach(add);
  return { tokens, byPath, docs, layout, problems };
}

export function indexByPath(tokens: Iterable<LogicalToken>): Map<string, LogicalToken> {
  const m = new Map<string, LogicalToken>();
  for (const t of tokens) m.set(t.path, t);
  return m;
}
