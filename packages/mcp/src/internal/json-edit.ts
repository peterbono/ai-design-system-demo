// Minimal-diff JSON editing: change one member of a JSON file without reformatting the rest.
// Token files mix multi-line and one-line objects; JSON.stringify would rewrite both and bury the real change.
// TO BE REPLACED by the minimal-diff writer in @bridge/core at merge time (see ../core-adapter.ts).

export type JNode =
  | { kind: 'object'; start: number; end: number; members: JMember[] }
  | { kind: 'array'; start: number; end: number; items: JNode[] }
  | { kind: 'value'; start: number; end: number };

export interface JMember {
  key: string;
  keyStart: number;
  keyEnd: number;
  value: JNode;
}

export function parseWithPositions(text: string): JNode {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const fail = (msg: string): never => {
    throw new Error(`JSON parse error at ${i}: ${msg}`);
  };
  const str = () => {
    if (text[i] !== '"') fail('expected string');
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail('unterminated string');
    i++;
    return { start, end: i, value: JSON.parse(text.slice(start, i)) as string };
  };
  const val = (): JNode => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const members: JMember[] = [];
      ws();
      if (text[i] === '}') return { kind: 'object', start, end: ++i, members };
      for (;;) {
        ws();
        const k = str();
        ws();
        if (text[i] !== ':') fail('expected :');
        i++;
        const v = val();
        members.push({ key: k.value, keyStart: k.start, keyEnd: k.end, value: v });
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') return { kind: 'object', start, end: ++i, members };
        fail('expected , or }');
      }
    }
    if (c === '[') {
      i++;
      const items: JNode[] = [];
      ws();
      if (text[i] === ']') return { kind: 'array', start, end: ++i, items };
      for (;;) {
        items.push(val());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') return { kind: 'array', start, end: ++i, items };
        fail('expected , or ]');
      }
    }
    if (c === '"') {
      const s = str();
      return { kind: 'value', start: s.start, end: s.end };
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) fail(`unexpected ${c}`);
    i += m![0].length;
    return { kind: 'value', start, end: i };
  };
  const root = val();
  ws();
  if (i < text.length) fail('trailing content');
  return root;
}

function lineIndent(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** One-line JSON in the house style: `{ "a": 1, "b": [1, 2] }`. */
export function compactJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(compactJson).join(', ')}]`;
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${compactJson(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

function multiJson(v: unknown, indent: string): string {
  return JSON.stringify(v, null, 2).split('\n').join(`\n${indent}`);
}

const isMultiline = (text: string, node: JNode) => text.slice(node.start, node.end).includes('\n');

function findObject(root: JNode, keys: string[]): Extract<JNode, { kind: 'object' }> | null {
  let node: JNode = root;
  for (const k of keys) {
    if (node.kind !== 'object') return null;
    const m: JMember | undefined = node.members.find((x) => x.key === k);
    if (!m) return null;
    node = m.value;
  }
  return node.kind === 'object' ? node : null;
}

const splice = (text: string, start: number, end: number, insert: string) => text.slice(0, start) + insert + text.slice(end);

/** Sets `keys[last]` inside the object at `keys[0..-1]`, creating missing parent groups. Returns the new text. */
export function setMember(text: string, keys: string[], value: unknown): string {
  const root = parseWithPositions(text);
  // Walk down as far as the path exists, then insert the rest as one nested object.
  let depth = 0;
  let obj = findObject(root, []);
  if (!obj) throw new Error('root is not an object');
  while (depth < keys.length - 1) {
    const next = findObject(root, keys.slice(0, depth + 1));
    if (!next) break;
    obj = next;
    depth++;
  }
  const key = keys[depth]!;
  let insertValue: unknown = value;
  for (let j = keys.length - 1; j > depth; j--) insertValue = { [keys[j]!]: insertValue };
  const existing = obj.members.find((m) => m.key === key);
  if (existing && depth === keys.length - 1) {
    // Keep the member's own layout; an object replacing a scalar follows its parent's layout.
    const multi = isMultiline(text, existing.value) || (typeof value === 'object' && value !== null && isMultiline(text, obj));
    const out = multi ? multiJson(value, lineIndent(text, existing.keyStart)) : compactJson(value);
    return splice(text, existing.value.start, existing.value.end, out);
  }
  return insertMember(text, obj, key, insertValue);
}

function insertMember(text: string, obj: Extract<JNode, { kind: 'object' }>, key: string, value: unknown): string {
  const multi = isMultiline(text, obj);
  if (!obj.members.length) {
    const pi = lineIndent(text, obj.start);
    const ind = `${pi}  `;
    return splice(text, obj.start, obj.end, `{\n${ind}${JSON.stringify(key)}: ${multiJson(value, ind)}\n${pi}}`);
  }
  const last = obj.members[obj.members.length - 1]!;
  if (multi) {
    const ind = lineIndent(text, obj.members[0]!.keyStart);
    return splice(text, last.value.end, last.value.end, `,\n${ind}${JSON.stringify(key)}: ${multiJson(value, ind)}`);
  }
  return splice(text, last.value.end, last.value.end, `, ${JSON.stringify(key)}: ${compactJson(value)}`);
}

/** Removes `keys[last]` from its parent object. Returns null when the member does not exist. */
export function removeMember(text: string, keys: string[]): string | null {
  const root = parseWithPositions(text);
  const obj = findObject(root, keys.slice(0, -1));
  if (!obj) return null;
  const idx = obj.members.findIndex((m) => m.key === keys[keys.length - 1]);
  if (idx < 0) return null;
  const m = obj.members[idx]!;
  if (obj.members.length === 1) return splice(text, obj.start, obj.end, '{}');
  if (idx > 0) return splice(text, obj.members[idx - 1]!.value.end, m.value.end, '');
  return splice(text, m.keyStart, obj.members[1]!.keyStart, '');
}

/** Removes a member, then removes parent groups left empty (only groups with no `$` metadata either). */
export function removeMemberPruning(text: string, keys: string[]): string | null {
  let out = removeMember(text, keys);
  if (out === null) return null;
  for (let d = keys.length - 1; d > 0; d--) {
    const parent = findObject(parseWithPositions(out), keys.slice(0, d));
    if (!parent || parent.members.length) break;
    out = removeMember(out, keys.slice(0, d))!;
  }
  return out;
}

export function getAt(json: unknown, keys: string[]): unknown {
  let n: unknown = json;
  for (const k of keys) {
    if (!n || typeof n !== 'object') return undefined;
    n = (n as Record<string, unknown>)[k];
  }
  return n;
}
