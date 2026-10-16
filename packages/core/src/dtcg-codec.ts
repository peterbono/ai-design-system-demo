// DTCG 2025.10 codec: read token files into flat tokens, and edit them in place without
// disturbing anything that did not change (key order, layout, number spelling, descriptions,
// $extensions). Built on the format-preserving JSON AST.

import {
  type JsonDocument,
  type JsonEntry,
  type JsonNode,
  type JsonObject,
  clearRawDeep,
  fromPlain,
  getEntry,
  parseJson,
  plainEqual,
  serializeJson,
  toPlain,
} from './json-ast';
import type { FlatToken } from './types';

export interface TokenDocument {
  file: string;
  json: JsonDocument;
}

export function parseTokenFile(file: string, text: string): TokenDocument {
  const json = parseJson(text);
  if (json.root.kind !== 'object') throw new Error(`${file}: top level must be a JSON object`);
  return { file, json };
}

export function serializeTokenFile(doc: TokenDocument): string {
  return serializeJson(doc.json);
}

const isTokenNode = (node: JsonNode): node is JsonObject => node.kind === 'object' && getEntry(node, '$value') !== undefined;
const isGroupKey = (key: string) => !key.startsWith('$');

/** All tokens in a document, in source order, with `$type` inherited from groups. */
export function flattenTokens(doc: TokenDocument): FlatToken[] {
  const out: FlatToken[] = [];
  const walk = (node: JsonObject, path: string[], inheritedType: string | undefined) => {
    const ownGroupType = stringEntry(node, '$type');
    const groupType = ownGroupType ?? inheritedType;
    for (const entry of node.entries) {
      if (!isGroupKey(entry.key) || entry.value.kind !== 'object') continue;
      const childPath = [...path, entry.key];
      if (isTokenNode(entry.value)) {
        out.push(readToken(entry.value, childPath.join('.'), groupType, doc.file));
      } else {
        walk(entry.value, childPath, groupType);
      }
    }
  };
  walk(doc.json.root as JsonObject, [], undefined);
  return out;
}

function readToken(node: JsonObject, path: string, inheritedType: string | undefined, file: string): FlatToken {
  const ownType = stringEntry(node, '$type');
  const ext = getEntry(node, '$extensions')?.value;
  return {
    path,
    type: ownType ?? inheritedType,
    ownType,
    value: toPlain(getEntry(node, '$value')!.value),
    description: stringEntry(node, '$description'),
    extensions: ext && ext.kind === 'object' ? (toPlain(ext) as Record<string, unknown>) : undefined,
    file,
  };
}

function stringEntry(node: JsonObject, key: string): string | undefined {
  const v = getEntry(node, key)?.value;
  return v && v.kind === 'string' ? (v.value as string) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Navigation

interface Located {
  node: JsonObject;
  /** Root first, parent group last. */
  ancestors: JsonObject[];
}

export function findToken(doc: TokenDocument, path: string): Located | undefined {
  const segments = path.split('.');
  const ancestors: JsonObject[] = [];
  let current = doc.json.root as JsonObject;
  for (const seg of segments) {
    ancestors.push(current);
    const next = getEntry(current, seg)?.value;
    if (!next || next.kind !== 'object') return undefined;
    current = next;
  }
  return isTokenNode(current) ? { node: current, ancestors } : undefined;
}

/** `$type` that a token at `path` would inherit from its groups (ignoring its own `$type`). */
export function inheritedTypeAt(doc: TokenDocument, path: string): string | undefined {
  const segments = path.split('.').slice(0, -1);
  let current: JsonNode | undefined = doc.json.root;
  let type: string | undefined;
  for (let idx = 0; idx <= segments.length; idx++) {
    if (!current || current.kind !== 'object') break;
    type = stringEntry(current, '$type') ?? type;
    const seg = segments[idx];
    if (seg === undefined) break;
    current = getEntry(current, seg)?.value;
  }
  return type;
}

const touch = (nodes: JsonNode[]) => nodes.forEach((n) => (n.raw = undefined));

// Canonical position for keys we insert into a token object.
const KEY_RANK: Record<string, number> = { $type: 0, $description: 1, $value: 2, $deprecated: 3, $extensions: 4 };
const rank = (key: string) => KEY_RANK[key] ?? 5;

function insertEntry(obj: JsonObject, entry: JsonEntry): void {
  // `$` keys go before the first `$` key that ranks higher, and before any child group.
  const r = rank(entry.key);
  const at = obj.entries.findIndex((e) => !e.key.startsWith('$') || rank(e.key) > r);
  if (at === -1) obj.entries.push(entry);
  else obj.entries.splice(at, 0, entry);
}

function findTemplateToken(group: JsonObject, doc: TokenDocument): JsonObject | undefined {
  const sibling = group.entries.find((e) => isGroupKey(e.key) && isTokenNode(e.value))?.value;
  if (sibling && sibling.kind === 'object') return sibling;
  let found: JsonObject | undefined;
  const walk = (node: JsonNode) => {
    if (found || node.kind !== 'object') return;
    if (getEntry(node, '$value')) {
      found = node;
      return;
    }
    node.entries.forEach((e) => isGroupKey(e.key) && walk(e.value));
  };
  walk(doc.json.root);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Edits

export interface TokenFields {
  type: string;
  value: unknown;
  description: string | undefined;
  /** Extension keys to set (value) or delete (undefined). Other keys are preserved. */
  extensions?: Record<string, unknown | undefined>;
}

/**
 * Create or update the token at `path`. Returns true when the document changed.
 * Values equal to the current ones are left untouched, so the file text stays identical.
 * `template` (for example the node of a renamed token) controls the layout of new nodes.
 */
export function upsertToken(doc: TokenDocument, path: string, fields: TokenFields, template?: JsonObject): boolean {
  const existing = findToken(doc, path);
  if (existing) return updateTokenNode(doc, existing, path, fields);

  const segments = path.split('.');
  const name = segments.pop()!;
  const ancestors: JsonObject[] = [];
  let group = doc.json.root as JsonObject;
  for (const seg of segments) {
    ancestors.push(group);
    let next = getEntry(group, seg)?.value;
    if (!next) {
      next = { kind: 'object', inline: false, entries: [] };
      group.entries.push({ key: seg, value: next });
    } else if (next.kind !== 'object' || isTokenNode(next)) {
      throw new Error(`${doc.file}: cannot create "${path}" because "${seg}" is a token, not a group`);
    }
    group = next;
  }
  ancestors.push(group);
  const layout = template ?? findTemplateToken(group, doc);
  const node: JsonObject = { kind: 'object', inline: layout?.inline ?? false, entries: [] };
  const inherited = inheritedTypeAt(doc, path);
  if (fields.type !== inherited) node.entries.push({ key: '$type', value: { kind: 'string', value: fields.type } });
  if (fields.description) node.entries.push({ key: '$description', value: { kind: 'string', value: fields.description } });
  const valueTemplate = layout ? getEntry(layout, '$value')?.value : undefined;
  node.entries.push({ key: '$value', value: fromPlain(fields.value, valueTemplate, node.inline) });
  const ext = cleanExtensions(fields.extensions);
  if (ext) {
    const extTemplate = layout ? getEntry(layout, '$extensions')?.value : undefined;
    node.entries.push({ key: '$extensions', value: fromPlain(ext, extTemplate, node.inline) });
  }
  group.entries.push({ key: name, value: node });
  touch(ancestors);
  return true;
}

function cleanExtensions(ext: Record<string, unknown | undefined> | undefined): Record<string, unknown> | undefined {
  if (!ext) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ext)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

function updateTokenNode(doc: TokenDocument, loc: Located, path: string, fields: TokenFields): boolean {
  const { node } = loc;
  let changed = false;

  // $type: only written when it differs from what the groups already say.
  const ownType = stringEntry(node, '$type');
  const inherited = inheritedTypeAt(doc, path);
  if ((ownType ?? inherited) !== fields.type) {
    const entry = getEntry(node, '$type');
    if (fields.type === inherited && entry) node.entries.splice(node.entries.indexOf(entry), 1);
    else if (entry) entry.value = { kind: 'string', value: fields.type };
    else insertEntry(node, { key: '$type', value: { kind: 'string', value: fields.type } });
    changed = true;
  }

  const valueEntry = getEntry(node, '$value')!;
  if (!plainEqual(toPlain(valueEntry.value), fields.value)) {
    valueEntry.value = fromPlain(fields.value, valueEntry.value, node.inline);
    changed = true;
  }

  const desc = stringEntry(node, '$description');
  if ((desc ?? '') !== (fields.description ?? '')) {
    const entry = getEntry(node, '$description');
    if (!fields.description) node.entries.splice(node.entries.indexOf(entry!), 1);
    else if (entry) entry.value = { kind: 'string', value: fields.description };
    else insertEntry(node, { key: '$description', value: { kind: 'string', value: fields.description } });
    changed = true;
  }

  if (fields.extensions) {
    let extEntry = getEntry(node, '$extensions');
    for (const [key, value] of Object.entries(fields.extensions)) {
      const ext = extEntry?.value.kind === 'object' ? extEntry.value : undefined;
      const current = ext ? getEntry(ext, key) : undefined;
      if (value === undefined) {
        if (ext && current) {
          ext.entries.splice(ext.entries.indexOf(current), 1);
          ext.raw = undefined;
          changed = true;
        }
        continue;
      }
      if (current && plainEqual(toPlain(current.value), value)) continue;
      if (!extEntry || !ext) {
        extEntry = { key: '$extensions', value: { kind: 'object', inline: node.inline, entries: [] } };
        insertEntry(node, extEntry);
      }
      const target = extEntry.value as JsonObject;
      if (current) current.value = fromPlain(value, current.value, target.inline);
      else target.entries.push({ key, value: fromPlain(value, undefined, target.inline) });
      target.raw = undefined;
      changed = true;
    }
    if (extEntry && extEntry.value.kind === 'object' && extEntry.value.entries.length === 0) {
      node.entries.splice(node.entries.indexOf(extEntry), 1);
      changed = true;
    }
  }

  if (changed) touch([...loc.ancestors, node]);
  return changed;
}

/** Remove a token and any group left empty by its removal. Returns true when something was removed. */
export function removeToken(doc: TokenDocument, path: string): boolean {
  const loc = findToken(doc, path);
  if (!loc) return false;
  const segments = path.split('.');
  let child: JsonNode = loc.node;
  for (let idx = loc.ancestors.length - 1; idx >= 0; idx--) {
    const parent = loc.ancestors[idx]!;
    const key = segments[idx]!;
    const entry = getEntry(parent, key);
    if (!entry || entry.value !== child) break;
    parent.entries.splice(parent.entries.indexOf(entry), 1);
    const hasChildren = parent.entries.some((e) => isGroupKey(e.key));
    if (hasChildren || idx === 0) break;
    child = parent;
  }
  touch(loc.ancestors);
  return true;
}

/** Raw token node at `path` (for use as a layout template when moving a token). */
export function tokenNode(doc: TokenDocument, path: string): JsonObject | undefined {
  return findToken(doc, path)?.node;
}

/** The token at `path` as written in this file (with inherited type), if any. */
export function readTokenAt(doc: TokenDocument, path: string): FlatToken | undefined {
  const loc = findToken(doc, path);
  return loc ? readToken(loc.node, path, inheritedTypeAt(doc, path), doc.file) : undefined;
}

/** A new, empty token file. */
export function emptyTokenFile(file: string): TokenDocument {
  return {
    file,
    json: {
      root: { kind: 'object', inline: false, entries: [] },
      leading: '',
      trailing: '\n',
      style: { indent: '  ', newline: '\n', objectPadding: true, arrayPadding: false },
    },
  };
}

/**
 * Move the token node at `from` to `to` inside the same file, keeping every field it has
 * ($description, $extensions from other tools, $deprecated...). Returns false when `from` is missing.
 */
export function moveToken(doc: TokenDocument, from: string, to: string): boolean {
  const loc = findToken(doc, from);
  if (!loc || findToken(doc, to)) return false;
  const node = loc.node;
  const fromType = stringEntry(node, '$type') ?? inheritedTypeAt(doc, from);
  removeToken(doc, from);
  const segments = to.split('.');
  const name = segments.pop()!;
  const ancestors: JsonObject[] = [];
  let group = doc.json.root as JsonObject;
  for (const seg of segments) {
    ancestors.push(group);
    let next = getEntry(group, seg)?.value;
    if (!next) {
      next = { kind: 'object', inline: false, entries: [] };
      group.entries.push({ key: seg, value: next });
    } else if (next.kind !== 'object' || isTokenNode(next)) {
      throw new Error(`${doc.file}: cannot move to "${to}" because "${seg}" is a token, not a group`);
    }
    group = next;
  }
  ancestors.push(group);
  clearRawDeep(node);
  group.entries.push({ key: name, value: node });
  touch(ancestors);
  // Keep the effective type: write $type when the new groups would infer something else.
  const inherited = inheritedTypeAt(doc, to);
  const typeEntry = getEntry(node, '$type');
  if (fromType && fromType !== inherited && !typeEntry) insertEntry(node, { key: '$type', value: { kind: 'string', value: fromType } });
  if (typeEntry && typeEntry.value.kind === 'string' && typeEntry.value.value === inherited) node.entries.splice(node.entries.indexOf(typeEntry), 1);
  return true;
}
