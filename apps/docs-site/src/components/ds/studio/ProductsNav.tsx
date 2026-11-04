// The side nav's "Products" group (layouts/Layout.astro, Studio only), like the project list in Figma's sidebar: each
// product bridge.config.json lists, a folder that opens its product page (lib/product-page.ts), the current one
// highlighted. Built from the build's products on the self-hosted Studio; on a team shell from the team's own
// settings once they are read (scripts/repo-context.ts, the bridge:team-model event). DS SidebarNav parts.
import { useEffect, useState } from 'react';
import { Folder, LibraryBig } from 'lucide-react';
import { SidebarNavItem, SidebarNavSection } from '@bridge-ds/react';
import { productsOf, type ProductConfig } from '@bridge-ds/core';
import { productHref, productKeyFromPath } from '../../../lib/product-page';

export interface NavProduct {
  key: string;
  name: string;
  /** The library itself (the default product). */
  library?: boolean;
}

/** The products the nav lists, in the configured order. */
export const navProducts = (products: readonly ProductConfig[]): NavProduct[] => products.map((p) => ({ key: p.key.toLowerCase(), name: p.name, ...(p.default ? { library: true } : {}) }));

export function ProductsNavView({ products, current }: { products: NavProduct[]; current: string | null }) {
  if (!products.length) return null;
  return (
    <SidebarNavSection title="Products" className="rail-products" data-products-nav="">
      {products.map((p) => (
        <SidebarNavItem key={p.key} href={productHref(p.key)} icon={p.library ? LibraryBig : Folder} active={current === p.key} data-keep-branch="">
          {p.name}
        </SidebarNavItem>
      ))}
    </SidebarNavSection>
  );
}

/** `products`: the build's (self-hosted); absent on a team shell, where the team's settings say. */
export default function ProductsNav({ products, current = null }: { products?: NavProduct[]; current?: string | null }) {
  const [list, setList] = useState<NavProduct[]>(products ?? []);
  const [here, setHere] = useState<string | null>(current);
  useEffect(() => {
    setHere(productKeyFromPath(location.pathname));
    let live = true;
    if (products) {
      // The build's products, with one this tab just added (it lists itself once the site is built again).
      void import('../../../scripts/repo-context').then(({ addedHere }) => {
        const keys = new Set(products.map((p) => p.key));
        const more = navProducts(addedHere().map((a) => a.entry)).filter((p) => !keys.has(p.key));
        if (!live || !more.length) return;
        const at = products.findIndex((p) => p.library);
        const next = [...products];
        next.splice(at >= 0 ? at : next.length, 0, ...more);
        setList(next);
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
  return <ProductsNavView products={list} current={here} />;
}
