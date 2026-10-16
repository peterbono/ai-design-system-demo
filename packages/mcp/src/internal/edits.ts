// Token edits (set, add, remove, rename) applied to file text with minimal diffs.
// TO BE REPLACED by the edit + minimal-diff writer in @bridge/core at merge time (see ../core-adapter.ts).
import { aliasTarget, TokenSet, type Combo } from './dtcg.js';
import { getAt, removeMemberPruning, setMember } from './json-edit.js';

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

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Turns friendly input ("#ff5500", "12px", "150ms", "{palette.x}") into the repo's DTCG form. */
export function coerceValue(input: unknown, type: string | undefined, existing?: unknown): unknown {
  if (typeof input !== 'string') return input;
  const s = input.trim();
  if (aliasTarget(s)) return s;
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      /* not JSON: keep going */
    }
  }
  const keepString = typeof existing === 'string' && !aliasTarget(existing);
  switch (type) {
    case 'color': {
      const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s) ?? /^#([0-9a-f]{3})$/i.exec(s);
      if (!m) return s;
      const hex6 = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
      if (keepString) return `#${hex6.toLowerCase()}${m[2] ?? ''}`;
      const comp = [0, 2, 4].map((i) => round3(parseInt(hex6.slice(i, i + 2), 16) / 255));
      const alpha = m[2] ? round3(parseInt(m[2], 16) / 255) : undefined;
      return { colorSpace: 'srgb', components: comp, ...(alpha !== undefined && alpha < 1 ? { alpha } : {}), hex: `#${hex6.toLowerCase()}` };
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

/** $type inherited by a new token at `keys` from its parent groups in this file. */
function inheritedType(json: unknown, keys: string[]): string | undefined {
  let t: string | undefined;
  let n: unknown = json;
  for (const k of keys.slice(0, -1)) {
    if (!n || typeof n !== 'object') break;
    const o = n as Record<string, unknown>;
    if (typeof o.$type === 'string') t = o.$type;
    n = o[k];
  }
  if (n && typeof n === 'object' && typeof (n as Record<string, unknown>).$type === 'string') t = (n as Record<string, string>).$type;
  return t;
}

export interface EditResult {
  files: Map<string, string>;
  touched: string[];
  notes: string[];
}

export function applyEdits(base: TokenSet, edits: TokenEdit[]): EditResult {
  // Each edit sees the result of the previous ones (add then set in one batch works).
  let set = base;
  const files = new Map(base.files);
  const touched = new Set<string>();
  const notes: string[] = [];
  const write = (f: string, text: string) => {
    files.set(f, text);
    touched.add(f);
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
  const keysOf = (p: string) => p.split('.');

  for (const e of edits) {
    if (!e.path || /[{}]/.test(e.path)) throw new Error(`Invalid token path "${e.path}". Use dots: color.text.muted.`);
    switch (e.op) {
      case 'set': {
        if (e.value === undefined && e.description === undefined && e.type === undefined) throw new Error(`set ${e.path}: give value, description or type.`);
        for (const f of pickFiles(e, false)) {
          const def = set.defs.find((d) => d.path === e.path && d.file === f)!;
          let text = files.get(f)!;
          if (e.value !== undefined) text = setMember(text, [...keysOf(e.path), '$value'], coerceValue(e.value, e.type ?? def.type, def.value));
          if (e.description !== undefined) text = setMember(text, [...keysOf(e.path), '$description'], e.description);
          if (e.type !== undefined && e.type !== def.type) text = setMember(text, [...keysOf(e.path), '$type'], e.type);
          write(f, text);
        }
        break;
      }
      case 'add': {
        let file = e.file;
        if (!file && e.mode) {
          const combo = set.normalizeCombo(e.mode);
          const parent = keysOf(e.path).slice(0, -1).join('.');
          const sib = [...set.view(combo).entries()].filter(([p]) => p.startsWith(`${parent}.`)).map(([, d]) => d[d.length - 1]!.file);
          file = sib[sib.length - 1];
        }
        if (!file) {
          // The file that already holds the closest parent group.
          const keys = keysOf(e.path);
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
        const json = JSON.parse(files.get(file)!);
        const inherited = inheritedType(json, keysOf(e.path));
        const type = e.type ?? inherited;
        if (!type && !aliasTarget(e.value)) throw new Error(`add ${e.path}: pass "type" (color, dimension, ...); no parent group sets one.`);
        const token: Record<string, unknown> = {};
        if (e.type && e.type !== inherited) token.$type = e.type;
        token.$value = coerceValue(e.value, type);
        if (e.description) token.$description = e.description;
        write(file, setMember(files.get(file)!, keysOf(e.path), token));
        break;
      }
      case 'remove': {
        for (const f of pickFiles(e, true)) {
          const out = removeMemberPruning(files.get(f)!, keysOf(e.path));
          if (out !== null) write(f, out);
        }
        const users = set.referencedBy(e.path).filter((u) => u.path !== e.path);
        if (users.length) notes.push(`${users.length} token(s) alias ${e.path}: ${users.slice(0, 8).map((u) => u.path).join(', ')}. Validation will flag them as broken unless they are edited too.`);
        break;
      }
      case 'rename': {
        if (!e.newPath || /[{}]/.test(e.newPath)) throw new Error(`rename ${e.path}: pass a valid newPath.`);
        if (set.defs.some((d) => d.path === e.newPath)) throw new Error(`rename: "${e.newPath}" already exists.`);
        for (const f of pickFiles(e, true)) {
          const node = getAt(JSON.parse(files.get(f)!), keysOf(e.path));
          let text = removeMemberPruning(files.get(f)!, keysOf(e.path))!;
          text = setMember(text, keysOf(e.newPath), node);
          write(f, text);
        }
        // Repoint every alias.
        const from = `"{${e.path}}"`;
        const to = `"{${e.newPath}}"`;
        for (const [f, text] of files) if (text.includes(from)) write(f, text.split(from).join(to));
        break;
      }
      default:
        throw new Error(`Unknown op "${(e as TokenEdit).op}". Use set, add, remove or rename.`);
    }
    set = new TokenSet(base.config, new Map(files));
  }
  return { files, touched: [...touched].sort(), notes };
}
