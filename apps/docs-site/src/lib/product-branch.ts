// The product branch page (?exploration=N for a branch started for a product) and the product context on a library
// review: pure view rules over the core records (packages/core/src/prod-branch.ts). The product branch page says, first,
// whether the branch is built with the library and what was missing; then one row per missing piece with the library
// branch it opened, its status and who reviews it; "Why it already shows in your screen" stays folded. Tested in
// product-branch.test.ts.
import {
  defaultProduct,
  LINK_STATUS_TONE,
  nearestQuestion,
  parseNeededBy,
  productOfBranch,
  suggestNearestComment,
  type LibraryLink,
  type LibraryPreviewKey,
  type LinkedLibraryBranch,
  type LinkStatus,
  type MissingPiece,
  type NeededBy,
  type PiecesRecord,
  type ProductConfig,
} from '@bridge-ds/core';
import { studioHref } from './team-path';

/** A branch started for a product (Create branch, A feature in a product): its label names a product other than the library. */
export function isProductBranch(labels: readonly (string | { name?: string })[] | null | undefined, products: readonly ProductConfig[]): ProductConfig | null {
  const names = (labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter((n) => n.toLowerCase().startsWith('product: '));
  if (!names.length) return null;
  const p = productOfBranch(products, { labels: names, files: null });
  return p.key === defaultProduct(products).key ? null : p;
}

export type OpensAs = 'pr' | 'exploration' | 'request' | 'suggestion';

/**
 * How a library branch opens in Studio: a branch in review (a promoted exploration too), an exploration, a request,
 * a suggestion (an issue a developer applies, ?suggestion=N).
 */
export function opensAs(link: Pick<LibraryLink, 'kind'>, status?: Pick<LinkStatus, 'key'> | null): OpensAs {
  if (link.kind === 'request') return 'request';
  if (link.kind === 'suggestion') return 'suggestion';
  if (link.kind === 'exploration' && (!status || status.key === 'exploring')) return 'exploration';
  return 'pr';
}

/** Where a library branch opens in Studio. */
export function libraryHref(link: Pick<LibraryLink, 'kind' | 'number'>, status?: Pick<LinkStatus, 'key'> | null): string {
  return `?${opensAs(link, status)}=${link.number}`;
}

const listNames = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names[0]} and ${names.length - 1} more`);

/** "In review · Dana reviews": the status line with people's names when known (logins otherwise). */
export function statusLine(s: Pick<LinkStatus, 'key' | 'label' | 'people'>, names: Record<string, string> = {}): string {
  if (!s.people.length) return s.label;
  const who = s.people.map((l) => names[l] ?? `@${l}`);
  const verb = s.key === 'changes' ? 'asks' : s.key === 'requested' || s.key === 'in-progress' ? 'builds' : 'reviews';
  return `${s.label} · ${listNames(who)} ${who.length === 1 ? verb : verb.replace(/s$/, '')}`;
}

export type PieceActionKind = 'open' | 'use-preview' | 'refresh-preview' | 'switch';

export interface PieceRowView {
  id: string;
  title: string;
  /** The value the branch writes by hand, shown with its swatch (TokenValue), when it has one. */
  value: string | null;
  /** The linked library branch: where it opens, its status line and tone. Null: no library branch yet. */
  library: { href: string; number: number; line: string; tone: (typeof LINK_STATUS_TONE)[keyof typeof LINK_STATUS_TONE]; opens: OpensAs } | null;
  /** The one action on the row, on the row's line. */
  action: { kind: PieceActionKind; label: string } | null;
  /** What the preview means for the product branch (the folded explanation picks from these). */
  preview: LibraryPreviewKey | null;
  previewSentence: string | null;
}

const mainValue = (p: MissingPiece | undefined): string | null => {
  if (!p) return null;
  const bg = p.values.find((v) => v.category === 'color' && /background/.test(v.property ?? ''));
  return (bg ?? p.values.find((v) => v.category === 'color') ?? p.values[0])?.value ?? null;
};

/**
 * One row per missing piece, linked ones first in the order they were opened, then the ones still without a library
 * branch (with "Send for review"). Links whose piece the latest check no longer finds still show.
 */
export function pieceRows(input: { record: PiecesRecord | undefined; linked: LinkedLibraryBranch[]; names?: Record<string, string> }): PieceRowView[] {
  const r = input.record;
  if (!r) return [];
  const rows: PieceRowView[] = input.linked.map((l) => {
    const piece = l.piece ?? r.pieces.find((p) => p.id === l.link.piece);
    return {
      id: l.link.piece,
      title: piece?.title ?? l.link.title,
      value: mainValue(piece),
      library: { href: libraryHref(l.link, l.status), number: l.link.number, line: statusLine(l.status, input.names), tone: LINK_STATUS_TONE[l.status.key], opens: opensAs(l.link, l.status) },
      action: l.preview.action ? { kind: l.preview.action.kind, label: l.preview.action.label } : null,
      preview: l.preview.key,
      previewSentence: l.preview.sentence,
    };
  });
  for (const p of r.pieces) {
    if (rows.some((x) => x.id === p.id) || r.links.some((l) => l.piece === p.id)) continue;
    rows.push({ id: p.id, title: p.title, value: mainValue(p), library: null, action: { kind: 'open', label: 'Send for review' }, preview: null, previewSentence: null });
  }
  return rows;
}

/**
 * "Why it already shows in your screen", folded under the pieces: the branch either carries the library branch (its
 * preview), or still draws the piece by hand until the library has it. Null when there is nothing to explain.
 */
export function whyItShows(rows: PieceRowView[]): { title: string; text: string } | null {
  if (!rows.length) return null;
  const has = (k: LibraryPreviewKey) => rows.some((r) => r.preview === k);
  const title = 'Why it already shows in your screen';
  if (has('preview') || has('outdated')) return { title, text: 'Your feature uses a preview of the library change. When the library publishes it, switch to the real version here in one click.' };
  if (has('published')) return { title, text: 'The library published it, and your feature still carries the preview. Switch to the published version to use the real one.' };
  if (rows.every((r) => r.preview === 'switched')) return { title: 'Where it comes from', text: 'Your feature uses the published version from the library.' };
  return { title, text: 'Your feature draws it by hand for now. When the library change has it, your feature uses its preview, then the real version once the library publishes it.' };
}

/** "Branches · Admin demo · DS-87": the way back and where the branch belongs. */
export function productCrumbs(product: string, jira: string | null, title: string): { label: string; href?: string }[] {
  return [{ label: 'Changes', href: studioHref('changes/') }, { label: product, href: studioHref('changes/') }, { label: jira ?? title }];
}

/** What a developer needs, in the "For developers" fold: the branch, the commands that check it and open library branches. */
export function developerLines(input: { number: number; branch: string; links: Pick<LibraryLink, 'kind' | 'number' | 'branch'>[]; /** Set in a product's own repository: "shop", so tools name it shop#12. */ product?: string | null; repo?: string | null }): { label: string; value: string }[] {
  const ref = input.product ? `${input.product}#${input.number}` : String(input.number);
  return [
    { label: 'Product branch', value: `${input.branch} (${input.repo ?? ''}#${input.number})` },
    ...input.links.map((l) => ({ label: l.kind === 'request' ? 'Library request' : l.kind === 'suggestion' ? 'Library suggestion' : 'Library branch', value: l.branch ? `${l.branch} (#${l.number})` : `#${l.number}` })),
    { label: 'Check it again', value: `bridge pieces ${ref} --record` },
    { label: 'With Claude', value: `bridge_missing_pieces { pr: ${input.product ? `"${ref}"` : ref}, record: true }` },
  ];
}

/** The sentence to say to Claude when the branch was never checked. */
export const ASK_CLAUDE = 'Ask Claude: "Check what my feature adds that the library does not have."';

// ---------------------------------------------------------------------------------------------------------------
// The library review: "Why it exists"

export interface ProductContextView {
  /** "Ann needs it for", the product branch title, "in Admin demo." */
  who: string;
  title: string;
  product: string;
  /** Studio's product branch page. */
  productHref: string;
  /** The reviewer's question when the closest library value may do, and the comment of "Suggest <nearest>". */
  question: string | null;
  suggest: { label: string; comment: string } | null;
  neededBy: NeededBy;
}

/** The product context of a library branch, from its "Needed by" block, or null for a branch nobody asked for. */
export function productContextOf(body: string | null | undefined, names: Record<string, string> = {}): ProductContextView | null {
  const n = parseNeededBy(body);
  if (!n) return null;
  const who = n.author ? (names[n.author] ?? `@${n.author}`) : 'A product team';
  const comment = suggestNearestComment(n);
  return {
    who,
    title: n.title,
    product: n.productName,
    // A product branch in the product's own repository ("Needed by" names it owner/name#12): its page carries the product.
    productHref: n.repo ? `?exploration=${n.pr}&product=${encodeURIComponent(n.product)}` : `?exploration=${n.pr}`,
    question: nearestQuestion(n, { names }),
    suggest: n.nearest && comment ? { label: `Suggest ${n.nearest}`, comment } : null,
    neededBy: n,
  };
}

/**
 * Rows of the Branches list with each library branch nested under the product branch that needs it (when that product
 * branch is listed): the library branch leaves its own group and follows its product branch, marked `child`. Counts
 * leave children out. Groups left empty disappear.
 */
export function nestLinked<R extends { r: { number: number; product?: string | null | undefined; neededBy?: number | null; neededByProduct?: string | null | undefined } }>(
  groups: { key: string; label: string; rows: R[] }[],
): { key: string; label: string; rows: (R & { child: boolean })[]; count: number }[] {
  // Keys across repositories: "12" in the design system, "shop#12" in the shop's own repository.
  const keyOf = (x: R) => (x.r.product ? `${x.r.product}#${x.r.number}` : String(x.r.number));
  const parentOf = (x: R) => (x.r.neededBy ? (x.r.neededByProduct ? `${x.r.neededByProduct}#${x.r.neededBy}` : String(x.r.neededBy)) : null);
  const listed = new Set(groups.flatMap((g) => g.rows.map(keyOf)));
  const nested = (x: R) => {
    const parent = parentOf(x);
    return Boolean(parent && parent !== keyOf(x) && listed.has(parent));
  };
  const children = new Map<string, R[]>();
  for (const g of groups) for (const x of g.rows) if (nested(x)) children.set(parentOf(x)!, [...(children.get(parentOf(x)!) ?? []), x]);
  return groups
    .map((g) => {
      const rows: (R & { child: boolean })[] = [];
      for (const x of g.rows) {
        if (nested(x)) continue;
        rows.push({ ...x, child: false });
        for (const c of children.get(keyOf(x)) ?? []) rows.push({ ...c, child: true });
      }
      return { key: g.key, label: g.label, rows, count: rows.filter((x) => !x.child).length };
    })
    .filter((g) => g.rows.length > 0);
}

/** The muted line of a nested library branch: "Library change it needs · Claude AI". */
export const childLine = (who: string) => `Library change it needs · ${who}`;
