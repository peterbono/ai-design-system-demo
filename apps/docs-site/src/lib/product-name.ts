// Renaming a product (bridge.config.json `products[i].name`) from its Studio page (components/ds/studio/ProductPage.tsx):
// the words, the check on what an admin typed, the format-preserving edit of the file, and the pull request that
// carries it (scripts/roles.ts proposeProductName, the same path as every config change from Studio). Only the name
// changes: the key, the repository and every other byte of the file stay. Pure, covered by product-name.test.ts.
import { fromPlain, getEntry, parseJson, serializeJson, type JsonArray, type JsonObject } from '@bridge-ds/core';

export const PRODUCT_NAME_MAX = 60;

export const PRODUCT_NAME_WORDS = {
  rename: (name: string) => `Rename ${name}`,
  label: 'Product name',
  save: 'Save',
  cancel: 'Cancel',
  sent: 'Rename sent for review. It shows everywhere once merged.',
  waiting: 'Rename waiting for review',
  refused: 'Bridge could not send the rename. Ask an admin of the repository.',
} as const;

/** The name as it is saved: trimmed, inner spaces folded to one. */
export const cleanProductName = (value: string) => value.trim().replace(/\s+/g, ' ');

/** What is wrong with a typed name, in one sentence that says how to fix it; null when it can be sent. */
export function productNameProblem(value: string, current: string, others: readonly { key: string; name: string }[], key: string): string | null {
  const name = cleanProductName(value);
  if (!name) return 'Type a name for the product.';
  if (name.length > PRODUCT_NAME_MAX) return `Keep it to ${PRODUCT_NAME_MAX} characters.`;
  if (name === cleanProductName(current)) return 'Type a different name, or press Escape to keep this one.';
  const lower = name.toLowerCase();
  if (others.some((p) => p.key.toLowerCase() !== key.toLowerCase() && p.name.trim().toLowerCase() === lower)) {
    return 'Another product already has this name. Pick a different one.';
  }
  return null;
}

/** bridge.config.json with the product `key`'s `name` set to `value` (cleaned); the rest byte for byte. */
export function withProductName(configText: string, key: string, value: string): string {
  const name = cleanProductName(value);
  if (!name || name.length > PRODUCT_NAME_MAX) throw new Error(`Type a name of 1 to ${PRODUCT_NAME_MAX} characters.`);
  const doc = parseJson(configText);
  if (doc.root.kind !== 'object') throw new Error('bridge.config.json is not a JSON object.');
  const root = doc.root as JsonObject;
  const list = getEntry(root, 'products')?.value;
  if (!list || list.kind !== 'array') throw new Error('The Bridge settings list no products to rename.');
  const item = (list as JsonArray).items.find((n): n is JsonObject => {
    if (n.kind !== 'object') return false;
    const k = getEntry(n, 'key')?.value;
    return k?.kind === 'string' && String(k.value).toLowerCase() === key.toLowerCase();
  });
  if (!item) throw new Error('The Bridge settings do not list this product.');
  const entry = getEntry(item, 'name');
  if (entry?.value.kind === 'string' && entry.value.value === name) return configText;
  const node = fromPlain(name, entry?.value, true);
  if (entry) entry.value = node;
  else {
    const at = item.entries.findIndex((e) => e.key === 'key');
    item.entries.splice(at + 1, 0, { key: 'name', value: node });
  }
  item.raw = undefined;
  list.raw = undefined;
  root.raw = undefined;
  return serializeJson(doc);
}

/** Branch, title, body and commit message of the pull request that renames the product. */
export function productNameProposal(x: { key: string; from: string; to: string }, opts: { date: Date; prefix?: string; tierLabel: string }): { branch: string; title: string; body: string; message: string } {
  const to = cleanProductName(x.to);
  const stamp = opts.date.toISOString().slice(0, 10).replace(/-/g, '');
  const slug = x.key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'product';
  const title = `chore(config): rename the product ${JSON.stringify(x.from)} to ${JSON.stringify(to)}`;
  const body = [
    '## The product name',
    '',
    `Sets \`products[key=${x.key}].name\` to ${JSON.stringify(to)} in \`bridge.config.json\` (was ${JSON.stringify(x.from)}).`,
    '',
    '- Studio, the Library and the exploration pages show it once this merges.',
    '- The product key, its repository and its explorations stay as they are.',
    '',
    `**Risk:** ${opts.tierLabel}. Configuration only: no token, component or package changes.`,
    '',
    '---',
    'Proposed from Bridge Studio.',
  ].join('\n');
  return { branch: `${opts.prefix ?? ''}product-name-${slug}-${stamp}`, title, body, message: `${title}\n\nProposed from Bridge Studio.` };
}
