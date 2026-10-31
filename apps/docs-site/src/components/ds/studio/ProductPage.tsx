// A product page of Studio (lib/product-page.ts), like a project in Figma: one page per product the team configures.
//   - The shared page header (StudioHead): the product's name, one live summary sentence ("2 exploring, 1 waiting for
//     code."), and "Start an exploration" at the end of the title's line, preselected with this product (the one start
//     flow, StartExploration). No drawing in the header: the action owns the end of the line.
//   - The product's facts on one quiet line: where it is live, its repository (or "In the library repository"), and
//     whether Bridge reaches it, when Studio already knows.
//   - Its explorations, grouped by where they stand (Exploring, Waiting for code, Being built, In review, Shipped: the lifecycle's words), each
//     the exploration card of the home (ExplorationCards.tsx); archived ones folded at the end.
//   - Nothing explored yet: a calm Field Guide drawing, shown at once, the reason in one sentence and the one action.
// Self-hosted (pages/studio/products/[key].astro) the key comes from the build; on a team shell
// (pages/team-shell/products/item.astro) from the address, once the team's settings are read. Reads:
// scripts/product-page.ts.
import { useEffect, useState } from 'react';
import { Accordion, AccordionItem, Link, Skeleton } from '@bridge-ds/react';
import type { ProductConfig } from '@bridge-ds/core';
import { StudioHead } from './StudioHead';
import { Drawing } from './Drawing';
import StartExploration from './StartExploration';
import { ExplorationCardItem } from './ExplorationCards';
import { emptyProductLine, productFacts, productGroups, productKeyFromPath, productSummary } from '../../../lib/product-page';
import { studioHref } from '../../../lib/team-path';
import type { ProductPageData } from '../../../scripts/product-page';
import type { HomeComponent } from './StudioHome';

export interface ProductPageViewProps {
  /** The key the page stands for. */
  productKey: string;
  data: ProductPageData | null;
  components: HomeComponent[];
}

function Facts({ product, data }: { product: ProductConfig; data: ProductPageData }) {
  const f = productFacts(product, data.ownRepo, data.reached);
  const parts = [
    f.production && (
      <Link key="prod" href={f.production.href} variant="subtle" external>
        {f.production.label}
      </Link>
    ),
    f.repo && (
      <Link key="repo" href={f.repo.href} variant="subtle" external>
        {f.repo.label}
      </Link>
    ),
    f.inLibrary && <span key="lib">{f.inLibrary}</span>,
    f.connection && (
      <span key="conn" className={f.connection.ok ? 'pp-conn' : 'pp-conn is-off'}>
        {f.connection.text}
      </span>
    ),
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <p className="t-ui t-muted pp-facts">
      {parts.map((node, i) => (
        <span key={i} className="pp-fact">
          {i > 0 && (
            <span className="pp-sep" aria-hidden="true">
              ·
            </span>
          )}
          {node}
        </span>
      ))}
    </p>
  );
}

/** The page, painted from what is read so far. Pure render: tested in ProductPage.test.ts. */
export function ProductPageView({ productKey, data, components }: ProductPageViewProps) {
  const product = data?.product ?? null;
  const loading = !data || data.loading;
  if (data && !data.loading && !product) {
    return (
      <>
        <StudioHead title="Product not found" summary={`This team lists no product called "${productKey}".`} />
        <p className="t-body">
          <Link href={studioHref('')}>Back to Home</Link>
        </p>
      </>
    );
  }
  const name = product?.name ?? '';
  const cards = data?.cards ?? [];
  const archived = data?.archived ?? [];
  const empty = !loading && !data?.failed && cards.length === 0;
  const library = Boolean(product?.default);
  const start = (appearance: 'menu' | 'button') => (
    <span className="cg-create" data-greet="">
      <StartExploration components={components} product={product?.key ?? productKey} appearance={appearance} />
    </span>
  );
  return (
    <div className="pp" data-product-page={product?.key ?? productKey}>
      <StudioHead
        title={name || ' '}
        summary={loading && !cards.length ? '' : data?.failed ? '' : productSummary(cards)}
        // One primary action: on the title's line, or in the empty moment when there is nothing yet.
        actions={product && !empty ? start('menu') : null}
      >
        {product && data && <Facts product={product} data={data} />}
      </StudioHead>
      {data?.failed && <p className="t-body t-muted">{data.failed}</p>}
      {loading && !cards.length ? (
        <ul className="sh-cards" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="sh-card-item">
              <Skeleton variant="rect" className="pp-skel" />
            </li>
          ))}
        </ul>
      ) : empty ? (
        <section className="zone pp-empty" aria-label={`Nothing explored in ${name} yet`}>
          <Drawing name="paint" width={160} />
          <div className="pp-empty-text">
            <p className="t-body">{product ? emptyProductLine(product, library) : ''}</p>
            {product && start('menu')}
          </div>
        </section>
      ) : (
        productGroups(cards).map((g) => (
          <section className="sh-section pp-group" key={g.key} aria-labelledby={`pp-${g.key}`} data-state-group={g.key}>
            <header className="sh-section-head">
              {/* The group heading of Changes (label and a muted count): the same kind of list reads the same. */}
              <h2 id={`pp-${g.key}`} className="pp-h2">
                {g.label} <span className="pp-count">{g.cards.length}</span>
              </h2>
            </header>
            <ul className="sh-cards">
              {g.cards.map((c) => (
                <ExplorationCardItem key={c.key ?? c.number} c={c} showProduct={false} />
              ))}
            </ul>
          </section>
        ))
      )}
      {archived.length > 0 && (
        <Accordion headingLevel={2} className="pp-archived">
          <AccordionItem value="archived" title="Archived" meta={archived.length}>
            <p className="t-ui t-muted pp-archived-note">Out of the lists, their previews still alive.</p>
            <ul className="sh-cards">
              {archived.map((c) => (
                <ExplorationCardItem key={c.key ?? c.number} c={c} showProduct={false} />
              ))}
            </ul>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

/** The island: reads the product (the team's settings first on a team shell) and repaints as data lands. */
export default function ProductPage({ productKey, components = [] }: { productKey?: string; components?: HomeComponent[] }) {
  const [key] = useState(() => productKey ?? (typeof location !== 'undefined' ? productKeyFromPath(location.pathname) : null) ?? '');
  const [data, setData] = useState<ProductPageData | null>(null);
  const [comps, setComps] = useState<HomeComponent[]>(components);
  useEffect(() => {
    let live = true;
    void (async () => {
      const { isHosted } = await import('../../../lib/team-path');
      if (isHosted()) {
        // A team's products and components come from its own bridge.config.json and design system.
        const { loadTeamData } = await import('../../../scripts/team-data');
        try {
          const team = await loadTeamData();
          if (live) setComps((team.model.components?.list ?? []).map((c) => ({ name: c.name, slug: c.slug, family: c.category })).sort((a, b) => a.name.localeCompare(b.name)));
        } catch {
          /* the products fall back to the defaults; the start flow still opens */
        }
      }
      const { loadProductPage } = await import('../../../scripts/product-page');
      await loadProductPage(key, (d) => live && setData(d));
    })();
    return () => {
      live = false;
    };
  }, [key]);
  useEffect(() => {
    // A team shell is built once for every product ("Product | Bridge Studio"): the tab names this one.
    if (data?.product) document.title = document.title.replace(/^[^|]*\|/, `${data.product.name} |`);
  }, [data?.product]);
  return <ProductPageView productKey={key} data={data} components={comps} />;
}
