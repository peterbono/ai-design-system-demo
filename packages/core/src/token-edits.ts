// Token edits (set, add, remove, rename) on a layered set, written back with minimal diffs through the
// format-preserving codec: untouched lines stay byte for byte, one-line tokens stay one line.

import { emptyTokenFile, inheritedTypeAt, moveToken, parseTokenFile, readTokenAt, removeToken, serializeTokenFile, upsertToken } from './dtcg-codec';
import { type Combo, LayeredTokenSet, aliasOf } from './layered';
import { hexToRgba, rgbaToDtcg } from './values';

export interface TokenEdit {
  op: 'set' | 'add' | 'remove' | 'rename';
  path: string;
  value?: unknown;
  type?: string;
  description?: string;
  newPath?: string;
  /** Token file relative to tokens.root, when the token lives in several files (light and dark). */
  file?: string;
  /** Alternative to `file`: edit the file that wins for this mode, e.g. { theme: "dark" }. */
  mode?: Partial<Combo>;
}

export interface EditResult {
  /** Every token file after the edits (relative to tokens.root). */
  files: Map<string, string>;
  /** Files whose text changed, sorted. */
  touched: string[];
  notes: string[];
}

/** Turns friendly input ("#ff5500", "12px", "150ms", "{palette.x}") into the repo's DTCG form. */
export function coerceValue(input: unknown, type: string | undefined, existing?: unknown): unknown {
  if (typeof input !== 'string') return input;
  const s = input.trim();
  if (aliasOf(s)) return s;
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      /* not JSON: keep going */
    }
  }
  // A repo that writes plain strings (hex colors, "12px") keeps getting plain strings.
  const keepString = typeof existing === 'string' && !aliasOf(existing);
  switch (type) {
    case 'color': {
      const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s) ?? /^#([0-9a-f]{3})$/i.exec(s);
      if (!m) return s;
      const hex6 = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
      if (keepString) return `#${hex6.toLowerCase()}${m[2] ?? ''}`;
      return rgbaToDtcg(hexToRgba(`#${hex6}${m[2] ?? ''}`)!);
    }
    case 'dimension': {
      const m = /^(-?\d*\.?\d+)\s*(px|rem)?$/.exec(s);
      if (!m || keepString) return s;
      return { value: Number(m[1]), unit: m[2] ?? 'px' };
    }
    case 'duration': {
      const m = /^(\d*\.?\d+)\s*(ms|s)?$/.exec(s);
      if (!m || keepString) return s;
      return { value: Number(m[1]), unit: m[2] ?? 'ms' };
    }
    case 'number':
    case 'fontWeight':
      return /^-?\d*\.?\d+$/.test(s) ? Number(s) : s;
    default:
      return s;
  }
}

/** Applies edits in order; each edit sees the result of the previous ones (add then set in one batch works). */
export function applyTokenEdits(base: LayeredTokenSet, edits: TokenEdit[]): EditResult {
  let set = base;
  const files = new Map(base.files);
  const touched = new Set<string>();
  const notes: string[] = [];
  const edit = (f: string, fn: (doc: ReturnType<typeof parseTokenFile>) => boolean) => {
    const doc = files.has(f) ? parseTokenFile(f, files.get(f)!) : emptyTokenFile(f);
    if (!fn(doc)) return;
    const text = serializeTokenFile(doc);
    if (text !== files.get(f)) {
      files.set(f, text);
      touched.add(f);
    }
  };
  const definingFiles = (path: string) => [...new Set(set.defs.filter((d) => d.path === path).map((d) => d.file))];
  const pickFiles = (e: TokenEdit, all: boolean): string[] => {
    const defs = definingFiles(e.path);
    if (e.file) {
      if (!files.has(e.file)) throw new Error(`File "${e.file}" is not a token file. Token files: ${set.fileNames.join(', ')}`);
      if (!defs.includes(e.file)) throw new Error(`"${e.path}" is not defined in ${e.file}. It is defined in: ${defs.join(', ') || 'no file (use op "add")'}.`);
      return [e.file];
    }
    if (e.mode) {
      const combo = set.normalizeCombo(e.mode);
      const v = set.view(combo).get(e.path);
      if (!v) throw new Error(`"${e.path}" is not defined for ${JSON.stringify(combo)}.`);
      return [v[v.length - 1]!.file];
    }
    if (!defs.length) throw new Error(`Token "${e.path}" does not exist. Use op "add" to create it.`);
    if (defs.length > 1 && !all) throw new Error(`"${e.path}" is defined in ${defs.length} files (${defs.join(', ')}). Pass "file" or "mode" (for example { "theme": "dark" }), or one edit per file.`);
    return defs;
  };

  for (const e of edits) {
    if (!e.path || /[{}]/.test(e.path)) throw new Error(`Invalid token path "${e.path}". Use dots: color.text.muted.`);
    switch (e.op) {
      case 'set': {
        if (e.value === undefined && e.description === undefined && e.type === undefined) throw new Error(`set ${e.path}: give value, description or type.`);
        for (const f of pickFiles(e, false)) {
          edit(f, (doc) => {
            const cur = readTokenAt(doc, e.path)!;
            const type = e.type ?? cur.type;
            return upsertToken(doc, e.path, {
              type,
              value: e.value === undefined ? cur.value : coerceValue(e.value, type, cur.value),
              description: e.description ?? cur.description,
            });
          });
        }
        break;
      }
      case 'add': {
        let file = e.file;
        if (!file && e.mode) {
          const combo = set.normalizeCombo(e.mode);
          const parent = e.path.split('.').slice(0, -1).join('.');
          const sib = [...set.view(combo).entries()].filter(([p]) => p.startsWith(`${parent}.`)).map(([, d]) => d[d.length - 1]!.file);
          file = sib[sib.length - 1];
        }
        if (!file) {
          // The file that already holds the closest parent group.
          const keys = e.path.split('.');
          for (let d = keys.length - 1; d > 0 && !file; d--) {
            const prefix = `${keys.slice(0, d).join('.')}.`;
            const fs = [...new Set(set.defs.filter((x) => x.path.startsWith(prefix)).map((x) => x.file))];
            if (fs.length === 1) file = fs[0];
            else if (fs.length > 1) throw new Error(`Where should "${e.path}" go? Its group exists in ${fs.join(', ')}. Pass "file" (one add per file for light and dark).`);
          }
        }
        if (!file) throw new Error(`Cannot infer a file for new token "${e.path}". Pass "file".`);
        if (!files.has(file)) throw new Error(`File "${file}" is not a token file. Token files: ${set.fileNames.join(', ')}`);
        if (set.defs.some((d) => d.path === e.path && d.file === file)) throw new Error(`"${e.path}" already exists in ${file}. Use op "set".`);
        if (e.value === undefined) throw new Error(`add ${e.path}: value is required.`);
        edit(file, (doc) => {
          const type = e.type ?? inheritedTypeAt(doc, e.path);
          if (!type && !aliasOf(e.value)) throw new Error(`add ${e.path}: pass "type" (color, dimension, ...); no parent group sets one.`);
          return upsertToken(doc, e.path, { type, value: coerceValue(e.value, type), description: e.description });
        });
        break;
      }
      case 'remove': {
        for (const f of pickFiles(e, true)) edit(f, (doc) => removeToken(doc, e.path));
        const users = set.referencedBy(e.path).filter((u) => u.path !== e.path);
        if (users.length) notes.push(`${users.length} token(s) alias ${e.path}: ${users.slice(0, 8).map((u) => u.path).join(', ')}. Validation will flag them as broken unless they are edited too.`);
        break;
      }
      case 'rename': {
        const to = e.newPath;
        if (!to || /[{}]/.test(to)) throw new Error(`rename ${e.path}: pass a valid newPath.`);
        if (set.defs.some((d) => d.path === to)) throw new Error(`rename: "${to}" already exists.`);
        for (const f of pickFiles(e, true)) edit(f, (doc) => moveToken(doc, e.path, to));
        // Repoint every alias.
        const from = `"{${e.path}}"`;
        const next = `"{${to}}"`;
        for (const [f, text] of files) {
          if (!text.includes(from)) continue;
          files.set(f, text.split(from).join(next));
          touched.add(f);
        }
        break;
      }
      default:
        throw new Error(`Unknown op "${(e as TokenEdit).op}". Use set, add, remove or rename.`);
    }
    set = new LayeredTokenSet(base.config, new Map(files));
  }
  return { files, touched: [...touched].filter((f) => files.get(f) !== base.files.get(f)).sort(), notes };
}
