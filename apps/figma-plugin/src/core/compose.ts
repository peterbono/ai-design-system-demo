// Apply accepted token changes onto main's files. Only files whose text actually changes are
// returned, and inside them only the edited tokens change (layout, key order, other tools'
// $extensions and untouched values are preserved byte for byte).

import {
  type TokenDocument,
  emptyTokenFile,
  moveToken,
  parseTokenFile,
  readTokenAt,
  removeToken,
  serializeTokenFile,
  upsertToken,
} from './dtcg-codec';
import { idExtensionFor } from './id-map';
import { defaultScopes, effectiveScopes, sameScopes } from './scopes';
import type { TokenSet } from './token-set';
import { EXT_ID, EXT_SCOPES, type LogicalToken } from './types';
import { valuesEqual } from './values';

export interface AcceptedChange {
  /** Desired state; undefined removes the token. */
  target: LogicalToken | undefined;
  /** State on main (head) before the change; undefined for additions. */
  current: LogicalToken | undefined;
}

export interface ComposeResult {
  /** Changed files only: path relative to the tokens directory -> new text. */
  files: Record<string, string>;
  /** Every token file after the change (changed and unchanged), for validation. */
  allFiles: Record<string, string>;
}

const modesOf = (t: LogicalToken) => Object.keys(t.values);

export function composeFiles(head: TokenSet, originals: Record<string, string>, changes: AcceptedChange[]): ComposeResult {
  const docs = new Map<string, TokenDocument>();
  const doc = (file: string): TokenDocument => {
    let d = docs.get(file);
    if (!d) {
      const text = originals[file];
      d = text === undefined ? emptyTokenFile(file) : parseTokenFile(file, text);
      docs.set(file, d);
    }
    return d;
  };
  const themeFile = new Map(head.layout.themes.map((t) => [t.mode, t.file]));
  const fileFor = (t: LogicalToken, mode: string, current?: LogicalToken) =>
    current?.files[mode] ??
    t.files[mode] ??
    (t.tier === 'semantic' ? themeFile.get(mode) : undefined) ??
    `primitives/${t.path.split('.')[0]}.tokens.json`;

  for (const { target, current } of changes) {
    if (!target) {
      if (current) for (const mode of modesOf(current)) removeToken(doc(fileFor(current, mode)), current.path);
      continue;
    }
    const renamed = !!current && current.path !== target.path;
    if (current) {
      for (const mode of modesOf(current)) {
        const d = doc(fileFor(current, mode));
        if (target.values[mode] === undefined) removeToken(d, current.path);
        else if (renamed) moveToken(d, current.path, target.path);
      }
    }

    const targetScopes = effectiveScopes(target);
    const scopesExt = sameScopes(targetScopes, defaultScopes(target.path, target.type, target.tier)) ? undefined : targetScopes;
    const scopesChanged = !current || !sameScopes(targetScopes, effectiveScopes(current));
    const descChanged = (target.description ?? '').trim() !== (current?.description ?? '').trim();

    for (const mode of modesOf(target)) {
      const d = doc(fileFor(target, mode, current));
      const existing = readTokenAt(d, target.path);
      const currentValue = current?.values[mode];
      // Keep main's exact spelling when the value is equal (Figma returns float noise).
      const value = currentValue !== undefined && valuesEqual(target.type, target.values[mode], currentValue) ? currentValue : target.values[mode];
      const extensions: Record<string, unknown> = {};
      if (scopesChanged) extensions[EXT_SCOPES] = scopesExt;
      if (renamed || !existing) extensions[EXT_ID] = idExtensionFor(target);
      upsertToken(d, target.path, {
        type: target.type,
        value,
        description: descChanged || !existing ? target.description : existing.description,
        extensions,
      });
    }
  }

  const files: Record<string, string> = {};
  const allFiles: Record<string, string> = { ...originals };
  for (const [file, d] of docs) {
    const text = serializeTokenFile(d);
    allFiles[file] = text;
    if (text !== originals[file]) files[file] = text;
  }
  return { files, allFiles };
}
