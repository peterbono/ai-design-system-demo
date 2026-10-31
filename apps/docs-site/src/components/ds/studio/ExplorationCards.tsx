// The card family of explorations, shared by the Studio home and the product pages (Gestalt similarity: the same kind
// of thing is the same card everywhere):
//   - ExplorationCardItem: one exploration, its explored screen on top, the title, then a fixed footer (its tag, the
//     product, who explores it).
//   - ProductFolderCard: one product, like a project folder in Figma: a mosaic of its latest explorations' screens
//     (their captures, else their plates), the product name and what is in progress ("2 exploring · 1 waiting for
//     code"). The whole card opens the product page (lib/product-page.ts).
import { Badge, Card, Link } from '@bridge-ds/react';
import { Who } from './faces';
import { BranchThumb } from './BranchThumb';
import type { ExplorationCard } from '../../../lib/home-explorations';
import type { ProductFolder } from '../../../lib/product-page';

export function ExplorationCardItem({ c, showProduct = true }: { c: ExplorationCard; showProduct?: boolean }) {
  return (
    <li className="sh-card-item">
      <Card interactive padding="none" className="sh-card">
        <BranchThumb spec={c.preview} size="card" />
        <div className="sh-card-body">
          <span className="sh-card-head">
            <Link href={c.href} variant="subtle" className="t-body sh-card-title" data-card-primary>
              <span className="sh-strong">{c.title}</span>
            </Link>
          </span>
          {/* A fixed footer, pinned to the bottom: the DS tag of its page, the product, who explores it, one line each
              (a long one ends in an ellipsis). Every card of a row has the same footer, so the tags, the product lines
              and the names line up whatever the titles' length; a card without a product keeps the line empty. On a
              product page the product goes without saying: the line is left out. */}
          <span className="sh-card-foot">
            <span className="sh-card-tagline">
              {c.state && (
                <Badge tone={c.tone ?? 'neutral'} dot={c.dot ?? false} size="md" className={c.state === 'Exploring' ? 'sh-card-tag xp-exploring' : 'sh-card-tag'}>
                  {c.state}
                </Badge>
              )}
            </span>
            {showProduct && <span className="t-ui t-muted sh-card-product">{c.product ? `in ${c.product}` : ' '}</span>}
            <span className="t-ui sh-card-who">
              <Who p={c.author} size="xs" />
              <span className="sh-card-name">{c.author.name}</span>
            </span>
          </span>
        </div>
      </Card>
    </li>
  );
}

/**
 * One product as a folder: the mosaic of its latest screens (one, two, or the newest large and the next two stacked),
 * its name and what is in progress. Nothing explored yet: the product's own plate, its Field Guide drawing.
 */
export function ProductFolderCard({ f }: { f: ProductFolder }) {
  const panes = f.shots.length ? f.shots : [{ key: `plate-${f.key}`, spec: { kind: 'screen' as const, src: null, seed: f.key } }];
  return (
    <li className="sh-card-item">
      <Card interactive padding="none" className="sh-card pf-card">
        <span className="pf-mosaic" data-panes={panes.length} aria-hidden="true">
          {panes.map((s, i) => (
            <span key={s.key} className={`pf-pane pf-pane-${i}`}>
              <BranchThumb spec={s.spec} size="card" />
            </span>
          ))}
        </span>
        <div className="sh-card-body">
          <span className="sh-card-head">
            <Link href={f.href} variant="subtle" className="t-body sh-card-title" data-card-primary>
              <span className="sh-strong">{f.name}</span>
            </Link>
          </span>
          <span className="sh-card-foot">
            <span className="t-ui t-muted sh-card-product">{f.line}</span>
          </span>
        </div>
      </Card>
    </li>
  );
}

/** "Products": a row of folder cards, aligned on the exploration cards' grid. */
export function ProductFolders({ folders }: { folders: ProductFolder[] }) {
  if (!folders.length) return null;
  return (
    <section className="sh-section" aria-labelledby="sh-products">
      <header className="sh-section-head">
        <h2 id="sh-products" className="sh-h2">
          Products
        </h2>
      </header>
      <ul className="sh-cards" data-product-folders="">
        {folders.map((f) => (
          <ProductFolderCard key={f.key} f={f} />
        ))}
      </ul>
    </section>
  );
}
