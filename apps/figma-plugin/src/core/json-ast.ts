// Format-preserving JSON AST.
//
// Every parsed node keeps the exact source slice it came from (`raw`). Serializing an untouched
// document therefore reproduces the input byte for byte. Edits clear `raw` on the edited node and
// its ancestors only, so a one-token change produces a one-token diff, in the file's own style
// (inline vs multi-line objects and arrays, indent width, padding inside inline braces).

export type JsonNode = JsonObject | JsonArray | JsonScalar;

interface NodeBase {
  /** Exact source text of this node. Present only while the node is untouched. */
  raw?: string | undefined;
}

export interface JsonEntry {
  key: string;
  value: JsonNode;
}

export interface JsonObject extends NodeBase {
  kind: 'object';
  entries: JsonEntry[];
  /** Written on a single line in the source (or should be, for new nodes). */
  inline: boolean;
}

export interface JsonArray extends NodeBase {
  kind: 'array';
  items: JsonNode[];
  inline: boolean;
}

export interface JsonScalar extends NodeBase {
  kind: 'string' | 'number' | 'boolean' | 'null';
  value: string | number | boolean | null;
}

export interface JsonStyle {
  indent: string;
  newline: '\n' | '\r\n';
  /** `{ "a": 1 }` (true) vs `{"a": 1}` (false) for inline objects. */
  objectPadding: boolean;
  /** `[ 1, 2 ]` (true) vs `[1, 2]` (false) for inline arrays. */
  arrayPadding: boolean;
}

export interface JsonDocument {
  root: JsonNode;
  leading: string;
  trailing: string;
  style: JsonStyle;
}

export class JsonParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = 'JsonParseError';
  }
}

// ---------------------------------------------------------------------------------------------
// Parsing

export function parseJson(text: string): JsonDocument {
  let i = 0;
  const n = text.length;

  const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  const skipWs = () => {
    while (i < n && isWs(text[i])) i++;
  };
  const fail = (msg: string): never => {
    throw new JsonParseError(`${msg} at offset ${i}`, i);
  };

  const parseString = (): string => {
    if (text[i] !== '"') fail('Expected string');
    const start = i;
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return JSON.parse(text.slice(start, i)) as string;
      }
      i++;
    }
    return fail('Unterminated string');
  };

  const parseValue = (): JsonNode => {
    skipWs();
    const start = i;
    const c = text[i];
    let node: JsonNode;
    if (c === '{') {
      i++;
      const entries: JsonEntry[] = [];
      skipWs();
      if (text[i] === '}') {
        i++;
      } else {
        for (;;) {
          skipWs();
          const key = parseString();
          skipWs();
          if (text[i] !== ':') fail('Expected ":"');
          i++;
          const value = parseValue();
          entries.push({ key, value });
          skipWs();
          if (text[i] === ',') {
            i++;
            continue;
          }
          if (text[i] === '}') {
            i++;
            break;
          }
          fail('Expected "," or "}"');
        }
      }
      const raw = text.slice(start, i);
      node = { kind: 'object', entries, inline: !raw.includes('\n'), raw };
    } else if (c === '[') {
      i++;
      const items: JsonNode[] = [];
      skipWs();
      if (text[i] === ']') {
        i++;
      } else {
        for (;;) {
          items.push(parseValue());
          skipWs();
          if (text[i] === ',') {
            i++;
            continue;
          }
          if (text[i] === ']') {
            i++;
            break;
          }
          fail('Expected "," or "]"');
        }
      }
      const raw = text.slice(start, i);
      node = { kind: 'array', items, inline: !raw.includes('\n'), raw };
    } else if (c === '"') {
      const value = parseString();
      node = { kind: 'string', value, raw: text.slice(start, i) };
    } else if (c === 't' && text.startsWith('true', i)) {
      i += 4;
      node = { kind: 'boolean', value: true, raw: 'true' };
    } else if (c === 'f' && text.startsWith('false', i)) {
      i += 5;
      node = { kind: 'boolean', value: false, raw: 'false' };
    } else if (c === 'n' && text.startsWith('null', i)) {
      i += 4;
      node = { kind: 'null', value: null, raw: 'null' };
    } else {
      const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
      if (!m) return fail('Unexpected token');
      i += m[0].length;
      node = { kind: 'number', value: Number(m[0]), raw: m[0] };
    }
    return node;
  };

  const leadingEnd = (() => {
    let j = 0;
    while (j < n && isWs(text[j])) j++;
    return j;
  })();
  const leading = text.slice(0, leadingEnd);
  i = leadingEnd;
  const root = parseValue();
  const trailingStart = i;
  skipWs();
  if (i < n) fail('Unexpected content after JSON value');
  const trailing = text.slice(trailingStart);

  return { root, leading, trailing, style: detectStyle(text, root) };
}

function detectStyle(text: string, root: JsonNode): JsonStyle {
  const newline: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  const indentMatch = /\n([ \t]+)\S/.exec(text);
  const indent = indentMatch?.[1] ?? '  ';
  let objectPadding: boolean | undefined;
  let arrayPadding: boolean | undefined;
  const visit = (node: JsonNode) => {
    if (node.kind === 'object') {
      if (node.inline && node.entries.length > 0 && objectPadding === undefined && node.raw) {
        objectPadding = node.raw.startsWith('{ ');
      }
      node.entries.forEach((e) => visit(e.value));
    } else if (node.kind === 'array') {
      if (node.inline && node.items.length > 0 && arrayPadding === undefined && node.raw) {
        arrayPadding = node.raw.startsWith('[ ');
      }
      node.items.forEach(visit);
    }
  };
  visit(root);
  return { indent, newline, objectPadding: objectPadding ?? true, arrayPadding: arrayPadding ?? false };
}

// ---------------------------------------------------------------------------------------------
// Serializing

export function serializeJson(doc: JsonDocument): string {
  return doc.leading + serializeNode(doc.root, 0, doc.style, false) + doc.trailing;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Cannot serialize non-finite number ${value}`);
  return JSON.stringify(value);
}

function serializeNode(node: JsonNode, depth: number, style: JsonStyle, forceInline: boolean): string {
  if (node.raw !== undefined && (!forceInline || !node.raw.includes('\n'))) return node.raw;
  switch (node.kind) {
    case 'string':
      return JSON.stringify(node.value);
    case 'number':
      return formatNumber(node.value as number);
    case 'boolean':
      return node.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'object': {
      if (node.entries.length === 0) return '{}';
      const inline = forceInline || node.inline;
      if (inline) {
        const body = node.entries
          .map((e) => `${JSON.stringify(e.key)}: ${serializeNode(e.value, depth + 1, style, true)}`)
          .join(', ');
        return style.objectPadding ? `{ ${body} }` : `{${body}}`;
      }
      const pad = style.indent.repeat(depth + 1);
      const body = node.entries
        .map((e) => `${pad}${JSON.stringify(e.key)}: ${serializeNode(e.value, depth + 1, style, false)}`)
        .join(`,${style.newline}`);
      return `{${style.newline}${body}${style.newline}${style.indent.repeat(depth)}}`;
    }
    case 'array': {
      if (node.items.length === 0) return '[]';
      const inline = forceInline || node.inline;
      if (inline) {
        const body = node.items.map((v) => serializeNode(v, depth + 1, style, true)).join(', ');
        return style.arrayPadding ? `[ ${body} ]` : `[${body}]`;
      }
      const pad = style.indent.repeat(depth + 1);
      const body = node.items.map((v) => `${pad}${serializeNode(v, depth + 1, style, false)}`).join(`,${style.newline}`);
      return `[${style.newline}${body}${style.newline}${style.indent.repeat(depth)}]`;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Conversions and helpers

export type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };

/** Plain JS value of a node. Object key order follows the source (except integer-like keys, see JS rules). */
export function toPlain(node: JsonNode): Plain {
  switch (node.kind) {
    case 'object': {
      const out: { [key: string]: Plain } = {};
      for (const e of node.entries) out[e.key] = toPlain(e.value);
      return out;
    }
    case 'array':
      return node.items.map(toPlain);
    default:
      return node.value as Plain;
  }
}

/**
 * Build a node from a plain value. When `template` is given (for example the node being replaced
 * or a sibling token), inline/multi-line layout is copied from it key by key so new content looks
 * like its neighbours.
 */
export function fromPlain(value: unknown, template?: JsonNode, inlineDefault = false): JsonNode {
  if (value === null || value === undefined) return { kind: 'null', value: null };
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (Array.isArray(value)) {
    const inline = template?.kind === 'array' ? template.inline : inlineDefault || value.every((v) => typeof v !== 'object' || v === null);
    const tItem = template?.kind === 'array' ? template.items[0] : undefined;
    return { kind: 'array', inline, items: value.map((v) => fromPlain(v, tItem, inline)) };
  }
  if (typeof value === 'object') {
    const inline = template?.kind === 'object' ? template.inline : inlineDefault;
    const entries: JsonEntry[] = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => {
        const t = template?.kind === 'object' ? getEntry(template, key)?.value : undefined;
        return { key, value: fromPlain(v, t, inline) };
      });
    return { kind: 'object', inline, entries };
  }
  throw new Error(`Unsupported value type ${typeof value}`);
}

export function getEntry(obj: JsonObject, key: string): JsonEntry | undefined {
  return obj.entries.find((e) => e.key === key);
}

export function getChild(node: JsonNode | undefined, key: string): JsonNode | undefined {
  if (!node || node.kind !== 'object') return undefined;
  return getEntry(node, key)?.value;
}

/** Remove cached source text from a node and all its descendants (after moving it to another depth). */
export function clearRawDeep(node: JsonNode): void {
  node.raw = undefined;
  if (node.kind === 'object') node.entries.forEach((e) => clearRawDeep(e.value));
  if (node.kind === 'array') node.items.forEach(clearRawDeep);
}

/** Deep structural equality of two nodes, ignoring layout. */
export function nodesEqual(a: JsonNode, b: JsonNode): boolean {
  return plainEqual(toPlain(a), toPlain(b));
}

export function plainEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, idx) => plainEqual(v, b[idx]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => plainEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
