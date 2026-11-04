import { describe, expect, it } from 'vitest';
import { productProblems, type ProductConfig } from '@bridge-ds/core';
import {
  ACCESS_MAX_MS,
  ACCESS_MESSAGE,
  accessStep,
  addProductProblem,
  addProductProposal,
  ADD_PRODUCT_WORDS,
  ADDED_KEEP_MS,
  addedKey,
  canAddProduct,
  copyRepoFor,
  foundLine,
  isAccessMessage,
  isDesignCopy,
  parseAdded,
  teamLeadsOf,
  withAddedProducts,
  mergeRepos,
  nameFromRepo,
  newProductEntry,
  newRepoIn,
  nothingNewLine,
  nothingYetLine,
  ownerAccountKey,
  ownersOnlyLine,
  ownsAccount,
  parseOwnerAccount,
  parsePending,
  PENDING_KEEP_MS,
  pendingKey,
  pickableRepos,
  popupFeatures,
  previewsFromCheckRuns,
  previewsFromStatuses,
  productKeyFor,
  productNameFor,
  requestSentLine,
  waitedTooLong,
  withNewProduct,
  type AccessStep,
} from './add-product';
import { DESIGN_COPY_DESCRIPTION, DESIGN_COPY_TOPIC } from './design-copy';

/** Every sentence of the dialog, the ones that take a name said with one. */
const WORDS = Object.values(ADD_PRODUCT_WORDS).map((w) => (typeof w === 'function' ? w('Checkout') : w));

const SHOP: ProductConfig = { key: 'admin-app', name: 'Art print shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' }, framework: 'react' };

const CONFIG = `{
  "version": 1,
  "products": [
    { "key": "admin-app", "name": "Art print shop", "repo": "acme/shop", "framework": "react" },
    { "key": "library", "name": "Library", "path": "packages", "framework": "react", "default": true }
  ],
  "tooling": { "paths": ["apps/"] }
}
`;

describe('add a product', () => {
  it('names and keys a product from its code name', () => {
    expect(nameFromRepo('art-print-shop')).toBe('Art print shop');
    expect(nameFromRepo('my_App.web')).toBe('My App web');
    expect(productKeyFor('Art-Print-Shop', [])).toBe('art-print-shop');
    expect(productKeyFor('shop', ['shop', 'shop-2'])).toBe('shop-3');
    expect(productKeyFor('***', [])).toBe('product');
  });

  it('says what is missing in one sentence', () => {
    expect(addProductProblem({ name: 'Shop', repo: null }, [])).toBe('Pick the product.');
    expect(addProductProblem({ name: 'x', repo: 'acme/shop' }, [SHOP])).toBe('Bridge already lists this product.');
    expect(addProductProblem({ name: 'x', repo: 'ACME/shop-design' }, [SHOP])).toBe('Bridge already lists this product.');
    expect(addProductProblem({ name: '  ', repo: 'acme/new' }, [SHOP])).toBe('Type a name for the product.');
    expect(addProductProblem({ name: 'art print SHOP', repo: 'acme/new' }, [SHOP])).toMatch(/Another product/);
    expect(addProductProblem({ name: 'Back office', repo: 'acme/new' }, [SHOP])).toBeNull();
  });

  it('reads the previews from the Vercel statuses, project and team from the inspector link', () => {
    expect(previewsFromStatuses([])).toBeNull();
    expect(previewsFromStatuses([{ context: 'ci/build', target_url: 'https://vercel.com/team/x/abc' }])).toBeNull();
    expect(previewsFromStatuses([{ context: 'Vercel', state: 'success', target_url: 'https://vercel.com/peterbonos-projects/bridge-product-admin/AbC123' }])).toEqual({
      preview: 'https://bridge-product-admin-git-{branch}-peterbonos-projects.vercel.app',
      production: 'https://bridge-product-admin.vercel.app',
    });
    expect(previewsFromStatuses([{ context: 'Vercel – shop-web', target_url: 'https://vercel.com/acme/shop-web/9Zx' }])?.preview).toBe('https://shop-web-git-{branch}-acme.vercel.app');
  });

  it('reads Netlify statuses and Cloudflare Pages check runs too', () => {
    expect(previewsFromStatuses([{ context: 'netlify/shop-web/deploy-preview', state: 'success', target_url: 'https://deploy-preview-3--shop-web.netlify.app' }])).toEqual({
      preview: 'https://deploy-preview-{pr}--shop-web.netlify.app',
      production: 'https://shop-web.netlify.app',
    });
    expect(previewsFromCheckRuns([])).toBeNull();
    expect(previewsFromCheckRuns([{ name: 'Tests', status: 'completed', app: 'github-actions', summary: 'ok' }])).toBeNull();
    expect(
      previewsFromCheckRuns([
        { name: 'Cloudflare Pages', status: 'completed', conclusion: 'success', app: 'cloudflare-workers-and-pages', summary: '| Preview URL: | https://1a2b3c4d.art-print-shop.pages.dev |\n| Branch Preview URL: | https://main.art-print-shop.pages.dev |' },
      ]),
    ).toEqual({ preview: 'https://{branch}.art-print-shop.pages.dev', production: 'https://art-print-shop.pages.dev' });
  });

  it('builds a valid entry, with the copy when asked', () => {
    const e = newProductEntry({ key: 'back-office', name: ' Back  office ', repo: 'acme/bo', copy: true, previews: { preview: 'https://bo-git-{branch}-acme.vercel.app', production: 'https://bo.vercel.app' } });
    expect(e).toEqual({ key: 'back-office', name: 'Back office', repo: 'acme/bo', design: { repo: 'acme/bo-design' }, preview: 'https://bo-git-{branch}-acme.vercel.app', production: 'https://bo.vercel.app', framework: 'react' });
    expect(Object.keys(e)).toEqual(['key', 'name', 'repo', 'design', 'preview', 'production', 'framework']);
    expect(newProductEntry({ key: 'k', name: 'K', repo: 'a/k', copy: false })).toEqual({ key: 'k', name: 'K', repo: 'a/k', framework: 'react' });
    expect(copyRepoFor('acme/bo')).toBe('acme/bo-design');
  });

  it('adds the product before the default one, one line like the others, the rest byte for byte', () => {
    const out = withNewProduct(CONFIG, newProductEntry({ key: 'bo', name: 'Back office', repo: 'acme/bo', copy: true }));
    expect(out).toBe(`{
  "version": 1,
  "products": [
    { "key": "admin-app", "name": "Art print shop", "repo": "acme/shop", "framework": "react" },
    { "key": "bo", "name": "Back office", "repo": "acme/bo", "design": { "repo": "acme/bo-design" }, "framework": "react" },
    { "key": "library", "name": "Library", "path": "packages", "framework": "react", "default": true }
  ],
  "tooling": { "paths": ["apps/"] }
}
`);
    const products = (JSON.parse(out) as { products: ProductConfig[] }).products;
    expect(productProblems(products)).toEqual([]);
  });

  it('gives a file without products the new one and the library', () => {
    const out = withNewProduct('{\n  "version": 1\n}\n', newProductEntry({ key: 'bo', name: 'Back office', repo: 'acme/bo', copy: false }));
    const products = (JSON.parse(out) as { products: ProductConfig[] }).products;
    expect(products.map((p) => p.key)).toEqual(['bo', 'library']);
    expect(products[1]!.default).toBe(true);
    expect(productProblems(products)).toEqual([]);
  });

  it('proposes it as a configuration change, in words a reviewer reads', () => {
    const p = addProductProposal(newProductEntry({ key: 'bo', name: 'Back office', repo: 'acme/bo', copy: true }), { date: new Date('2026-11-01T10:00:00Z'), tierLabel: 'Tier 1' });
    expect(p.branch).toBe('product-add-bo-20261101');
    expect(p.title).toBe('chore(config): add the product "Back office"');
    expect(p.body).toContain('acme/bo-design');
    expect(p.body).toContain('found after the first change');
  });

  it('never says repository, fork or config to designers', () => {
    for (const w of WORDS) expect(w).not.toMatch(/repositor|fork|config|branch/i);
  });
});

describe('giving Bridge access from the dialog', () => {
  const r = (full: string) => ({ full, name: full.split('/')[1]!, defaultBranch: 'main' });

  it('lists what can be picked: never the design system, a listed product or its copy, an archived one, twice', () => {
    const repos = [
      { full_name: 'acme/ds', name: 'ds' },
      { full_name: 'acme/shop', name: 'shop' },
      { full_name: 'acme/shop-design', name: 'shop-design' },
      { full_name: 'acme/old', name: 'old', archived: true },
      { full_name: 'acme/zeta', name: 'zeta', default_branch: 'trunk' },
      { full_name: 'acme/back', name: 'back' },
      { full_name: 'ACME/back', name: 'back' },
    ];
    expect(pickableRepos(repos, [SHOP], 'Acme/DS')).toEqual([
      { full: 'acme/back', name: 'back', defaultBranch: 'main' },
      { full: 'acme/zeta', name: 'zeta', defaultBranch: 'trunk' },
    ]);
  });

  it('finds the product that was not there when GitHub opened', () => {
    expect(newRepoIn([], [])).toBeNull();
    expect(newRepoIn(['acme/shop'], [r('acme/shop')])).toBeNull();
    expect(newRepoIn(['ACME/Shop'], [r('acme/shop'), r('acme/print')])).toEqual(r('acme/print'));
    expect(mergeRepos([r('acme/zeta')], [r('acme/zeta'), r('acme/back')]).map((x) => x.full)).toEqual(['acme/back', 'acme/zeta']);
  });

  it('waits, then goes back to the form, says nothing new, or is busy', () => {
    const list: AccessStep = { kind: 'list' };
    const waiting = accessStep(list, { type: 'open', at: 1000 });
    expect(waiting).toEqual({ kind: 'waiting', since: 1000 });
    expect(accessStep(waiting, { type: 'cancel' })).toEqual(list);
    expect(accessStep(waiting, { type: 'found' })).toEqual(list);
    expect(accessStep(waiting, { type: 'closed' })).toEqual({ kind: 'nothing-new' });
    expect(accessStep(waiting, { type: 'timeout' })).toEqual({ kind: 'nothing-new' });
    // Closing only means "nothing new" while waiting.
    expect(accessStep(list, { type: 'closed' })).toBe(list);
    expect(accessStep({ kind: 'nothing-new' }, { type: 'found' })).toEqual(list);
    const busy = accessStep(waiting, { type: 'busy', resetsAt: null, source: 'github' });
    expect(busy).toEqual({ kind: 'busy', resetsAt: null, source: 'github' });
    expect(accessStep(busy, { type: 'read' })).toEqual(list);
    expect(accessStep(waiting, { type: 'read' })).toBe(waiting);
    expect(waitedTooLong(waiting, 1000 + ACCESS_MAX_MS - 1)).toBe(false);
    expect(waitedTooLong(waiting, 1000 + ACCESS_MAX_MS)).toBe(true);
    expect(waitedTooLong(list, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("trusts only this site's return message", () => {
    const origin = 'https://bridge.example.com';
    expect(isAccessMessage({ origin, data: { type: ACCESS_MESSAGE } }, origin)).toBe(true);
    expect(isAccessMessage({ origin: 'https://evil.example', data: { type: ACCESS_MESSAGE } }, origin)).toBe(false);
    expect(isAccessMessage({ origin, data: { type: 'other' } }, origin)).toBe(false);
    expect(isAccessMessage({ origin, data: ACCESS_MESSAGE }, origin)).toBe(false);
    expect(isAccessMessage({ origin, data: null }, origin)).toBe(false);
  });

  it('centers the GitHub window on the window it opens from', () => {
    expect(popupFeatures({ screenX: 100, screenY: 50, outerWidth: 1440, outerHeight: 900 })).toBe('popup=yes,width=1020,height=760,left=310,top=120');
    expect(popupFeatures({ screenX: 0, screenY: 0, outerWidth: 390, outerHeight: 844 })).toBe('popup=yes,width=1020,height=760,left=0,top=42');
  });

  it('names a picked product for the person, unique among the listed ones', () => {
    const shop = { full: 'studio/shop', name: 'shop' };
    expect(productNameFor({ full: 'acme/art-print-shop', name: 'art-print-shop' }, [])).toBe('Art print shop');
    expect(productNameFor(shop, [{ name: 'Checkout' }])).toBe('Shop');
    expect(productNameFor(shop, [{ name: ' shop ' }])).toBe('Shop (studio)');
    expect(productNameFor(shop, [{ name: 'Shop' }, { name: 'Shop (studio)' }])).toBe('Shop (studio) 2');
  });

  it('says what arrived and who decides, in designer words', () => {
    expect(foundLine('Art print shop')).toBe("Art print shop is here. Add it when you're ready.");
    expect(nothingNewLine('acme')).toBe('Nothing new yet. If GitHub asked you to request access, the owners of acme get it; this list updates when they approve.');
    expect(nothingNewLine(null)).toContain('the owners of that account');
    for (const w of [foundLine('x'), nothingNewLine('acme'), nothingYetLine('acme'), ownersOnlyLine('acme'), requestSentLine('acme', null), ...WORDS]) {
      expect(w).not.toMatch(/repositor|installation|fork|config|—/i);
    }
  });
});

describe('someone who can only request access', () => {
  it('knows who can give access: their own account, an owner of the organization, else nobody here', () => {
    expect(ownsAccount({ login: 'Ann', account: 'ann' })).toBe(true);
    expect(ownsAccount({ login: 'ann', account: 'bob', type: 'User' })).toBe(false);
    expect(ownsAccount({ login: 'ann', account: 'acme', type: 'Organization', membership: { role: 'admin', state: 'active' } })).toBe(true);
    expect(ownsAccount({ login: 'ann', account: 'acme', type: 'Organization', membership: { role: 'member', state: 'active' } })).toBe(false);
    // An invitation not accepted yet is not ownership.
    expect(ownsAccount({ login: 'ann', account: 'acme', membership: { role: 'admin', state: 'pending' } })).toBe(false);
    // GitHub says no membership at all: they can only request.
    expect(ownsAccount({ login: 'ann', account: 'acme', membership: null })).toBe(false);
    // Not readable: unknown, the dialog keeps its usual words.
    expect(ownsAccount({ login: 'ann', account: 'acme', type: 'Organization' })).toBeNull();
    expect(ownsAccount({ login: null, account: 'acme' })).toBeNull();
  });

  it('says who decides before GitHub opens, and what happens after', () => {
    expect(ownersOnlyLine('acme')).toBe('Only the owners of acme can show Bridge where it is. GitHub sends them your request.');
    expect(requestSentLine('acme', 'Shop')).toBe('Request sent to the owners of acme. Bridge shows Shop here as soon as they approve.');
    expect(requestSentLine('acme', '  ')).toBe('Request sent to the owners of acme. Bridge shows your product here as soon as they approve.');
    expect(nothingYetLine('acme')).toBe('Nothing new yet. If GitHub asked you to request access, the owners of acme decide. Bridge shows your product here when they approve.');
    expect(nothingYetLine(undefined)).toContain('the owners of that account');
  });

  it('closes on a request sent, and opens on it again', () => {
    const list: AccessStep = { kind: 'list' };
    const waiting = accessStep(list, { type: 'open', at: 1 });
    expect(accessStep(waiting, { type: 'closed', requested: true })).toEqual({ kind: 'requested' });
    expect(accessStep(waiting, { type: 'timeout', requested: true })).toEqual({ kind: 'requested' });
    expect(accessStep(waiting, { type: 'closed', requested: false })).toEqual({ kind: 'nothing-new' });
    expect(accessStep(list, { type: 'pending' })).toEqual({ kind: 'requested' });
    // Only the form takes a kept request: never over a wait or a busy GitHub.
    expect(accessStep(waiting, { type: 'pending' })).toBe(waiting);
    const requested: AccessStep = { kind: 'requested' };
    expect(accessStep(requested, { type: 'found' })).toEqual(list);
    expect(accessStep(requested, { type: 'cancel' })).toEqual(list);
    expect(accessStep(requested, { type: 'closed', requested: true })).toBe(requested);
    expect(accessStep(requested, { type: 'open', at: 2 })).toEqual({ kind: 'waiting', since: 2 });
  });

  it('remembers a request per team, for a while, and drops anything else', () => {
    expect(pendingKey('Acme/DS')).toBe(pendingKey('acme/ds'));
    const at = 1_000_000;
    const kept = { account: 'acme', product: 'Shop', before: ['acme/a', 3], at };
    expect(parsePending(JSON.stringify(kept), at + 1)).toEqual({ account: 'acme', product: 'Shop', before: ['acme/a'], at });
    expect(parsePending(JSON.stringify({ ...kept, product: '' }), at)?.product).toBeNull();
    expect(parsePending(JSON.stringify(kept), at + PENDING_KEEP_MS + 1)).toBeNull();
    expect(parsePending(JSON.stringify({ ...kept, account: '' }), at)).toBeNull();
    expect(parsePending('{nope', at)).toBeNull();
    expect(parsePending(null, at)).toBeNull();
    expect(parsePending('null', at)).toBeNull();
  });
});

describe("the team's account, for the GitHub step", () => {
  it('reads its id and type from GitHub, and nothing else', () => {
    expect(parseOwnerAccount({ id: 351104414, type: 'Organization', login: 'the-bridge-company' })).toEqual({ id: 351104414, type: 'Organization' });
    expect(parseOwnerAccount({ id: 63565173, type: 'User' })).toEqual({ id: 63565173, type: 'User' });
    expect(parseOwnerAccount({ id: 5 })).toEqual({ id: 5, type: 'User' });
    for (const bad of [null, undefined, 'x', {}, { id: '5' }, { id: 0 }, { id: -1 }, { id: 1.5 }]) expect(parseOwnerAccount(bad)).toBeNull();
  });

  it('keeps it per account, any case', () => {
    expect(ownerAccountKey('The-Bridge-Company')).toBe(ownerAccountKey(' the-bridge-company '));
  });
});

describe('the words of the dialog', () => {
  it('never says a technical word, never an em dash', () => {
    const W = ADD_PRODUCT_WORDS;
    for (const line of [W.unreadLine, W.unreadAction, W.foundLead, W.newLead, W.codeOnGitHub, W.findThere, W.startNew, W.sent, W.reviewLine('Checkout'), W.refused, W.addLabel('Checkout')]) {
      expect(line).not.toMatch(/\u2014|repositor|installation|permission|token|API|config|pull request|merge/i);
    }
  });
});

describe('Bridge never offers its own designers\' copies as products', () => {
  const base = { copies: new Set<string>(), products: new Set<string>(['acme/checkout']) };

  it('reads the mark Bridge puts on a copy it makes: the topic, or the description', () => {
    expect(isDesignCopy({ full_name: 'acme/anything', topics: [DESIGN_COPY_TOPIC] }, base)).toBe(true);
    expect(isDesignCopy({ full_name: 'acme/anything', topics: ['Bridge-Design-Copy'] }, base)).toBe(true);
    expect(isDesignCopy({ full_name: 'acme/anything', description: DESIGN_COPY_DESCRIPTION }, base)).toBe(true);
    expect(isDesignCopy({ full_name: 'acme/anything', description: ' bridge explorations for this product live here ' }, base)).toBe(true);
    expect(isDesignCopy({ full_name: 'acme/anything', description: 'Our marketing site', topics: ['react'] }, base)).toBe(false);
  });

  it("knows a listed product's copy, and a <product>-design or -design-old next to a product", () => {
    expect(isDesignCopy({ full_name: 'acme/shop-copy' }, { ...base, copies: new Set(['acme/shop-copy']) })).toBe(true);
    expect(isDesignCopy({ full_name: 'acme/checkout-design' }, base)).toBe(true);
    expect(isDesignCopy({ full_name: 'Acme/Checkout-Design-Old' }, base)).toBe(true);
    // Not next to a known product: a real product that happens to end in "-design".
    expect(isDesignCopy({ full_name: 'acme/interior-design' }, base)).toBe(false);
    expect(isDesignCopy({ full_name: 'other/checkout-design' }, base)).toBe(false);
  });

  it('leaves them out of the list Bridge found, wherever they come from', () => {
    const repos = [
      { full_name: 'acme/checkout', name: 'checkout' },
      { full_name: 'acme/checkout-design', name: 'checkout-design' },
      { full_name: 'acme/checkout-design-old', name: 'checkout-design-old' },
      { full_name: 'acme/mobile-app', name: 'mobile-app' },
      { full_name: 'acme/marked', name: 'marked', topics: [DESIGN_COPY_TOPIC] },
      { full_name: 'acme/described', name: 'described', description: DESIGN_COPY_DESCRIPTION },
      { full_name: 'acme/shop-design', name: 'shop-design' },
      { full_name: 'acme/legacy-copy', name: 'legacy-copy' },
      { full_name: 'acme/interior-design', name: 'interior-design' },
    ];
    const listed = [SHOP, { key: 'old', name: 'Old', repo: 'acme/old', design: { repo: 'acme/legacy-copy' } } as ProductConfig];
    expect(pickableRepos(repos, listed, 'acme/ds').map((r) => r.full)).toEqual(['acme/checkout', 'acme/interior-design', 'acme/mobile-app']);
  });

  it('counts a product listed under an old name as listed, and never offers the design system itself', () => {
    const repos = [
      { full_name: 'the-bridge-company/shop', name: 'shop' },
      { full_name: 'the-bridge-company/ai-design-system-demo', name: 'ai-design-system-demo' },
    ];
    expect(pickableRepos(repos, [{ repo: 'art-print-shop-co/shop' } as ProductConfig], 'peterbono/ai-design-system-demo')).toEqual([]);
  });
});

describe('who adds products', () => {
  const config = { governance: { owners: { design: ['@Dana'], tech: ['malik', '@acme/web'] }, override: { allowed: ['sam'] } } };

  it('reads the leads from the owners and the override list, people only', () => {
    expect(teamLeadsOf(config).sort()).toEqual(['dana', 'malik', 'sam']);
    // The page's settings (core SiteRepo) keep them at the top.
    expect(teamLeadsOf(config.governance).sort()).toEqual(['dana', 'malik', 'sam']);
    expect(teamLeadsOf(null)).toEqual([]);
    expect(teamLeadsOf({ governance: { owners: { design: 'dana' } } })).toEqual([]);
  });

  it('admins and leads signed in with GitHub; never an email member, a plain writer or the sample team', () => {
    const can = (access: Parameters<typeof canAddProduct>[0], login: string | null, sample = false) => canAddProduct(access, { sample, login, config });
    expect(can({ admin: true, write: true }, 'someone')).toBe(true);
    expect(can({ admin: false, repoAdmin: true }, 'someone')).toBe(true);
    expect(can({ admin: false, write: true }, 'Malik')).toBe(true);
    expect(can({ admin: false, write: false }, 'malik')).toBe(false);
    expect(can({ admin: false, write: true }, 'priya')).toBe(false);
    expect(can({ admin: true, write: true, contributor: true }, 'dana')).toBe(false);
    expect(can({ admin: true, write: true }, 'dana', true)).toBe(false);
    expect(can(null, 'dana')).toBe(false);
  });
});

describe('a product just added shows at once', () => {
  const NEW: ProductConfig = { key: 'checkout', name: 'Checkout', repo: 'acme/checkout', framework: 'react' };
  const LIB: ProductConfig = { key: 'library', name: 'Library', default: true };

  it('goes in before the library, once, until the settings list it', () => {
    const added = [{ entry: NEW, at: 1000 }];
    expect(withAddedProducts([SHOP, LIB], added).map((p) => p.key)).toEqual(['admin-app', 'checkout', 'library']);
    expect(withAddedProducts([SHOP, { ...NEW, name: 'Renamed' }, LIB], added).map((p) => p.name)).toEqual(['Art print shop', 'Renamed', 'Library']);
    expect(withAddedProducts([SHOP], added).map((p) => p.key)).toEqual(['admin-app', 'checkout']);
  });

  it('keeps it for a while only, and ignores anything that is not one', () => {
    const now = 5_000_000;
    const kept = JSON.stringify([{ entry: NEW, at: now - 1000 }, { entry: NEW, at: now - ADDED_KEEP_MS - 1 }, { entry: { key: 1 }, at: now }, null]);
    expect(parseAdded(kept, now)).toEqual([{ entry: NEW, at: now - 1000 }]);
    for (const bad of [null, '', 'x', '{}', '[1]']) expect(parseAdded(bad, now)).toEqual([]);
    expect(addedKey('Acme/DS')).toBe(addedKey('acme/ds'));
  });
});
