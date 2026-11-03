// Removing a product from Bridge (the product page's "More actions" menu, components/ds/studio/ProductPage.tsx): the
// words, the rule of the confirm field, the format-preserving edit that drops the product from bridge.config.json, and
// the pull request that carries it (scripts/roles.ts proposeProductRemoval, the same path as a rename or a new product).
// It only disconnects the product from Bridge: nothing on GitHub is deleted, the product's code and everything in it
// stay as they are. Never the library (the default product). Designers never read "repository" or "config" here. Pure,
// covered by remove-product.test.ts.
import { getEntry, parseJson, serializeJson, type JsonArray, type JsonObject } from '@bridge-ds/core';
import { confirmMatches } from './delete-team';

export const REMOVE_PRODUCT_WORDS = {
  more: (name: string) => `More actions for ${name}`,
  rename: 'Rename',
  remove: 'Remove from Bridge',
  title: (name: string) => `Remove ${name} from Bridge?`,
  text: (name: string) => `${name} leaves Studio and everyone's lists once your team approves it. Its explorations stop showing here.`,
  safe: 'Bridge deletes nothing on GitHub: the product, its code and everything in it stay as they are. You can add it again any time.',
  confirmLabel: (name: string) => `Type ${name} to confirm`,
  cancel: 'Cancel',
  sent: (name: string) => `Removal sent for review. ${name} leaves Bridge once it is approved.`,
  waiting: 'Removal waiting for review',
  refused: 'Bridge could not send the removal. Ask an admin of the repository.',
} as const;

/** The confirm field matches when it says the product's name exactly (spaces around it aside), as Delete team. */
export const removeConfirmMatches = (typed: string, name: string): boolean => confirmMatches(typed, name);

const keyOf = (n: JsonArray['items'][number]): string | null => {
  if (n.kind !== 'object') return null;
  const k = getEntry(n as JsonObject, 'key')?.value;
  return k?.kind === 'string' ? String(k.value) : null;
};

const isDefault = (n: JsonArray['items'][number]): boolean => {
  if (n.kind !== 'object') return false;
  const d = getEntry(n as JsonObject, 'default')?.value;
  return d?.kind === 'boolean' && (d as { value: boolean }).value === true;
};

/**
 * bridge.config.json without the product `key` in `products`; the rest byte for byte. Refuses the library (the
 * default product) and a product the file does not list. Only this file changes: nothing on GitHub is deleted.
 */
export function withoutProduct(configText: string, key: string): string {
  const doc = parseJson(configText);
  if (doc.root.kind !== 'object') throw new Error('bridge.config.json is not a JSON object.');
  const root = doc.root as JsonObject;
  const list = getEntry(root, 'products')?.value;
  if (!list || list.kind !== 'array') throw new Error('The Bridge settings list no products to remove.');
  const items = (list as JsonArray).items;
  const at = items.findIndex((n) => keyOf(n)?.toLowerCase() === key.toLowerCase());
  if (at < 0) throw new Error('The Bridge settings do not list this product.');
  if (isDefault(items[at]!)) throw new Error('The library stays in Bridge.');
  items.splice(at, 1);
  list.raw = undefined;
  root.raw = undefined;
  return serializeJson(doc);
}

/** Branch, title, body and commit message of the pull request that removes the product from Bridge. */
export function removeProductProposal(
  x: { key: string; name: string; repo?: string },
  opts: { date: Date; prefix?: string; tierLabel: string }
): { branch: string; title: string; body: string; message: string } {
  const stamp = opts.date.toISOString().slice(0, 10).replace(/-/g, '');
  const slug =
    x.key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'product';
  const title = `chore(config): remove the product ${JSON.stringify(x.name)} from Bridge`;
  const body = [
    '## Remove a product from Bridge',
    '',
    `Removes \`products[key=${x.key}]\` (${JSON.stringify(x.name)}) from \`bridge.config.json\`.`,
    '',
    '- Studio and the Library stop listing it once this merges.',
    `- Nothing is deleted on GitHub${
      x.repo ? `: \`${x.repo}\`, its branches and its pull requests stay as they are` : ''
    }. Adding the product again brings it back.`,
    '',
    `**Risk:** ${opts.tierLabel}. Configuration only: no token, component or package changes.`,
    '',
    '---',
    'Proposed from Bridge Studio.',
  ].join('\n');
  return { branch: `${opts.prefix ?? ''}product-remove-${slug}-${stamp}`, title, body, message: `${title}\n\nProposed from Bridge Studio.` };
}
