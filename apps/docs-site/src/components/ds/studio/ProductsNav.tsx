// The side nav's two groups (layouts/Layout.astro, Studio only; owner-approved option A, 2026-11-04, boards NavTwo,
// NavMany, NavAllProducts, NavPhone), under Home, Changes and Being built, Settings below them at the foot:
//   Products        the team's products, like the project list in Figma's sidebar: the viewer's own first, at most
//                   five, then "All products" with the total when the team has more (lib/nav-products.ts). The product
//                   open on screen always shows.
//   Design system   Components, Tokens, Quality, and Explorations: the library's own product page.
// Built from the build's products on the self-hosted Studio; on a team shell from the team's own settings once they are
// read (scripts/repo-context.ts, the bridge:team-model event). The same rail is the phone's menu. DS SidebarNav parts.
import { useEffect, useState } from 'react';
import { Folder, LibraryBig, PanelsTopLeft } from 'lucide-react';
import { SidebarNavItem, SidebarNavSection } from '@bridge-ds/react';
import { productsOf, type ProductConfig } from '@bridge-ds/core';
import { productHref, productKeyFromPath } from '../../../lib/product-page';
import { isHosted, STUDIO_ROOT, studioBase, studioHref } from '../../../lib/team-path';
import { libraryOf, navProductRows, navProducts, NO_SIGNALS, readSignals, type NavProduct, type ProductSignals } from '../../../lib/nav-products';
import { siteIcon } from '../../../brand/site-icons';
import type { IconName } from '../../../brand/icons';

export { navProducts, type NavProduct };

/** A Design system page of the nav (lib/nav.ts studioNav, place 'design-system'). */
export interface NavPage {
  href: string;
  label: string;
  icon: IconName;
}

/** The All products page (pages/studio/products/index.astro). */
export const ALL_PRODUCTS_PATH = `${STUDIO_ROOT}products/`;

/** Explorations: the library's product page, named for what it holds. */
export const EXPLORATIONS_LABEL = 'Explorations';

/** Whether the nav entry for `href` holds the page at `path` (itself, or a page under it). */
const holds = (href: string, path: string) => path === href || (href !== STUDIO_ROOT && path.startsWith(href));

export interface ProductsNavViewProps {
  products: NavProduct[];
  /** The product open on screen (its key), else null. */
  current: string | null;
  /** The Studio page on screen, as a self-hosted path ('/studio/tokens/'). */
  path?: string;
  /** Components, Tokens, Quality: the Design system group's pages before Explorations. */
  pages?: NavPage[];
  signals?: ProductSignals;
}

export function ProductsNavView({ products, current, path = '', pages = [], signals = NO_SIGNALS }: ProductsNavViewProps) {
  const rows = navProductRows(products, signals, current);
  const library = libraryOf(products);
  const allHere = path === ALL_PRODUCTS_PATH;
  return (
    <>
      {rows.shown.length > 0 && (
        <SidebarNavSection title="Products" className="rail-section rail-products" data-products-nav="">
          {rows.shown.map((p) => (
            <SidebarNavItem key={p.key} href={productHref(p.key)} icon={Folder} active={current === p.key} data-keep-branch="">
              {p.name}
            </SidebarNavItem>
          ))}
          {rows.all && (
            <SidebarNavItem href={studioHref('products/')} icon={PanelsTopLeft} className="rail-all" active={allHere} count={rows.total} data-keep-branch="" aria-label={`All products, ${rows.total}`}>
              All products
            </SidebarNavItem>
          )}
        </SidebarNavSection>
      )}
      <SidebarNavSection title="Design system" className="rail-section rail-design-system" data-design-system-nav="">
        {pages.map((p) => (
          <SidebarNavItem key={p.href} href={studioHref(p.href)} icon={siteIcon(p.icon)} active={holds(p.href, path)} data-keep-branch="">
            {p.label}
          </SidebarNavItem>
        ))}
        {library && (
          <SidebarNavItem href={productHref(library.key)} icon={LibraryBig} active={current === library.key} data-keep-branch="">
            {EXPLORATIONS_LABEL}
          </SidebarNavItem>
        )}
      </SidebarNavSection>
    </>
  );
}

/** The Studio page on screen as a self-hosted path: a team's /studio/acme/ds/tokens/ is /studio/tokens/. */
function studioPathHere(): string {
  const base = studioBase(location.pathname, isHosted());
  return `${STUDIO_ROOT}${location.pathname.slice(base.length)}`.replace(/\/?$/, '/');
}

/** The team of the page ("owner/repo"), for what this browser kept about its products. */
async function teamHere(): Promise<string | null> {
  const { repoContext } = await import('../../../scripts/repo-context');
  const r = repoContext();
  return r.owner && r.repo ? `${r.owner}/${r.repo}` : null;
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export interface ProductsNavProps {
  /** The build's products (self-hosted); absent on a team shell, where the team's settings say. */
  products?: NavProduct[];
  current?: string | null;
  path?: string;
  pages?: NavPage[];
}

export default function ProductsNav({ products, current = null, path = '', pages = [] }: ProductsNavProps) {
  const [list, setList] = useState<NavProduct[]>(products ?? []);
  const [here, setHere] = useState<string | null>(current);
  const [at, setAt] = useState(path);
  const [signals, setSignals] = useState<ProductSignals>(NO_SIGNALS);
  // Once mounted, the links point at the team in the address (studioHref) and the order reads this browser.
  const [, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setHere(productKeyFromPath(location.pathname));
    setAt(studioPathHere());
    let live = true;
    void teamHere().then((team) => live && setSignals(readSignals(team, storage())));
    if (products) {
      // The build's products, with one this tab just added (it lists itself once the site is built again).
      void import('../../../scripts/repo-context').then(({ addedHere }) => {
        const keys = new Set(products.map((p) => p.key));
        const more = navProducts(addedHere().map((a) => a.entry)).filter((p) => !keys.has(p.key));
        if (!live || !more.length) return;
        setList([...products, ...more]);
      });
      return () => {
        live = false;
      };
    }
    const read = () =>
      void import('../../../scripts/repo-context').then(({ siteConfig }) => {
        const site = siteConfig() as { products?: ProductConfig[] };
        // Nothing read yet: wait for the team's settings rather than list the defaults.
        if (live && Object.keys(site).length) setList(navProducts(productsOf(site)));
      });
    read();
    document.addEventListener('bridge:team-model', read);
    return () => {
      live = false;
      document.removeEventListener('bridge:team-model', read);
    };
  }, [products]);
  return <ProductsNavView products={list} current={here} path={at} pages={pages} signals={signals} />;
}
