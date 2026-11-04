// All products (pages/studio/products/index.astro, team shell pages/team-shell/products/index.astro; owner-approved
// board NavAllProducts, 2026-11-04): "All products" in the side nav opens it when a team has more products than the
// nav lists. One summary line ("15 products. Yours come first."), Add a product for whoever may add one (admins and
// leads, AddProduct.tsx), a "Find a product" filter, then one row per product: its name to its page, the same status
// line as its folder on Home (lib/product-page.ts folderLine), and a quiet "You explore here" on the viewer's own.
// Long lists show ALL_PRODUCTS_PAGE rows at a time ("Show 8 more"). The library is not listed: it is Explorations,
// under Design system. Rules: lib/nav-products.ts.
import { useEffect, useMemo, useState } from 'react';
import { Folder, Search } from 'lucide-react';
import { Button, Field, Icon, Input, Link } from '@bridge-ds/react';
import type { ProductConfig } from '@bridge-ds/core';
import { StudioHead } from './StudioHead';
import AddProduct from './AddProduct';
import { cardProductKey, folderLine, productHref } from '../../../lib/product-page';
import type { ExplorationCard } from '../../../lib/home-explorations';
import { ALL_PRODUCTS_PAGE, allProductsLine, filterProducts, moreLabel, navProducts, noMatchLine, NO_SIGNALS, orderProducts, OWN_MARKER, readSignals, type NavProduct, type ProductSignals } from '../../../lib/nav-products';
import '../../../styles/all-products.css';

export interface AllProductsRow extends NavProduct {
  /** "2 exploring · 1 waiting to be picked up", "Nothing explored yet"; empty while unknown. */
  line: string;
  own: boolean;
}

/** The rows, the viewer's own first (lib/nav-products orderProducts), each with its status line once read. */
export function allProductsRows(products: readonly ProductConfig[], cards: readonly ExplorationCard[] | null, signals: ProductSignals): AllProductsRow[] {
  return orderProducts(navProducts(products), signals).map((p) => {
    const mine = cards ? cards.filter((c) => cardProductKey(c, products) === p.key) : null;
    return { ...p, line: mine === null ? '' : mine.length ? folderLine(mine) : 'Nothing explored yet', own: signals.mine[p.key] !== undefined };
  });
}

export interface AllProductsViewProps {
  rows: AllProductsRow[];
  /** The configured products, for Add a product. */
  products: ProductConfig[];
  /** Still reading the team's settings: no count, no rows yet. */
  loading?: boolean;
}

export function AllProductsView({ rows, products, loading = false }: AllProductsViewProps) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(ALL_PRODUCTS_PAGE);
  const found = useMemo(() => filterProducts(rows, query), [rows, query]);
  const visible = found.slice(0, shown);
  const left = found.length - visible.length;
  return (
    <div className="ap">
      <StudioHead title="All products" summary={loading ? '' : allProductsLine(rows.length)} actions={!loading && products.length > 0 ? <AddProduct products={products} /> : null} />
      {!loading && rows.length > ALL_PRODUCTS_PAGE && (
        <Field label="Find a product" className="ap-find">
          <Input
            type="search"
            size="md"
            prefix={<Icon icon={Search} size="sm" />}
            autoComplete="off"
            value={query}
            onValueChange={(v: string) => {
              setQuery(v);
              setShown(ALL_PRODUCTS_PAGE);
            }}
          />
        </Field>
      )}
      {query && !found.length ? (
        <p className="t-ui t-muted ap-none" role="status">
          {noMatchLine(query)}
        </p>
      ) : (
        <ul className="ap-list" aria-label="Products">
          {visible.map((r) => (
            <li key={r.key} className="ap-row">
              <Icon icon={Folder} size="md" className="ap-icon" />
              <Link variant="subtle" href={productHref(r.key)} className="ap-name">
                {r.name}
              </Link>
              <span className="ap-line">{r.line}</span>
              {r.own && <span className="ap-own">{OWN_MARKER}</span>}
            </li>
          ))}
        </ul>
      )}
      {left > 0 && (
        <Button variant="ghost" className="ap-more" onClick={() => setShown((n) => n + ALL_PRODUCTS_PAGE)}>
          {moreLabel(left)}
        </Button>
      )}
    </div>
  );
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export default function AllProducts() {
  const [products, setProducts] = useState<ProductConfig[] | null>(null);
  const [cards, setCards] = useState<ExplorationCard[] | null>(null);
  const [signals, setSignals] = useState<ProductSignals>(NO_SIGNALS);
  useEffect(() => {
    let live = true;
    const team = async () => {
      const { repoContext } = await import('../../../scripts/repo-context');
      const r = repoContext();
      return `${r.owner}/${r.repo}`;
    };
    const readList = async () => {
      const [{ configuredProducts }, { siteConfig }] = await Promise.all([import('../../../scripts/product-repos'), import('../../../scripts/repo-context')]);
      // Nothing read yet (a team's settings): wait rather than list the defaults.
      if (live && Object.keys(siteConfig()).length) setProducts(configuredProducts());
    };
    const onModel = () => void readList();
    document.addEventListener('bridge:team-model', onModel);
    void (async () => {
      const { isHosted } = await import('../../../lib/team-path');
      // A team's products come from its own bridge.config.json.
      if (isHosted()) await import('../../../scripts/team-data').then((m) => m.loadTeamData()).catch(() => null);
      await readList();
      if (live) setSignals(readSignals(await team(), storage()));
      const { sessionSettled } = await import('../../../scripts/github-session');
      await sessionSettled();
      const read = await import('../../../scripts/all-products').then((m) => m.readAllProducts()).catch(() => null);
      if (!live) return;
      setCards(read && !read.busy ? read.cards : null);
      // The read noted what the viewer explores in: the rows put those first now.
      setSignals(readSignals(await team(), storage()));
    })();
    return () => {
      live = false;
      document.removeEventListener('bridge:team-model', onModel);
    };
  }, []);
  const list = useMemo(() => products ?? [], [products]);
  const rows = useMemo(() => allProductsRows(list, cards, signals), [list, cards, signals]);
  return <AllProductsView rows={rows} products={list} loading={products === null} />;
}
