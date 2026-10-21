// The token editor's draft as core token edits (set, add, remove, rename), the semantic form a suggestion stores and a
// developer re-applies on the tokens of the day (applyTokenEdits), never a text patch. Each edit names the file it
// targets, so a token defined in light and dark files is edited where the draft edited it. Pure: no DOM.
import { defaultFile, isMultiMode, modeFile, type LogicalToken, type TokenEdit, type TokenSet } from '@bridge-ds/core';
import { draftToChanges, type Draft } from './editor-model';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The file a value of `t` lives in for `mode`, the way the editor writes it (compose.ts fileFor). */
function fileFor(head: TokenSet, t: LogicalToken, mode: string, current?: LogicalToken): string {
  return current?.files[mode] ?? t.files[mode] ?? (isMultiMode(t.tier) ? modeFile(head.layout, t.tier, mode) : undefined) ?? defaultFile(t.tier, t.path, head.options.dirs);
}

/**
 * Token edits for the draft, one token at a time (the last edit of a token and mode wins, like the editor): a removal,
 * a new token per file it lands in, or a rename then the values and the description that changed. Docs edits are not
 * token edits and are left out.
 */
export function draftTokenEdits(head: TokenSet, draft: Draft): TokenEdit[] {
  const out: TokenEdit[] = [];
  for (const { current, target } of draftToChanges(head, draft)) {
    if (current && !target) {
      out.push({ op: 'remove', path: current.path });
      continue;
    }
    if (!target) continue;
    if (!current) {
      const seen = new Set<string>();
      for (const [mode, value] of Object.entries(target.values)) {
        const file = fileFor(head, target, mode);
        if (seen.has(file)) continue;
        seen.add(file);
        out.push({ op: 'add', path: target.path, type: target.type, value, file, ...(target.description ? { description: target.description } : {}) });
      }
      continue;
    }
    if (current.path !== target.path) out.push({ op: 'rename', path: current.path, newPath: target.path });
    for (const [mode, value] of Object.entries(target.values)) {
      if (same(value, current.values[mode])) continue;
      out.push({ op: 'set', path: target.path, value, file: fileFor(head, target, mode, current) });
    }
    if ((target.description ?? '').trim() !== (current.description ?? '').trim()) {
      for (const file of new Set(Object.keys(current.values).map((m) => fileFor(head, current, m)))) out.push({ op: 'set', path: target.path, description: target.description ?? '', file });
    }
  }
  return out;
}
