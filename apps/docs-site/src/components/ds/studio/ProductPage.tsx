// A product page of Studio (lib/product-page.ts), like a project in Figma: one page per product the team configures.
//   - The shared page header (StudioHead): the product's name, one live summary sentence ("2 exploring, 1 waiting for
//     code."), and "Start an exploration" at the end of the title's line, preselected with this product (the one start
//     flow, StartExploration). No drawing in the header: the action owns the end of the line.
//   - One quiet line under the header: "Open the live product", and a warning only when Bridge cannot reach it.
//   - Its explorations, grouped by where they stand (Exploring, Waiting for code, Being built, In review, Shipped: the lifecycle's words), each
//     the exploration card of the home (ExplorationCards.tsx); archived ones only counted in one quiet line at the end
//     ("1 archived. See archived"), which opens Changes' Archived tab for this product.
//   - Nothing explored yet: a calm Field Guide drawing, shown at once, the reason in one sentence and the one action.
//   - Rename (admins of the team's repository on a team shell, never the sample team, never self-hosted): a pencil right
//     after the title opens the name in place (a DS Input, Save, Escape cancels). Save sends the config pull request
//     that changes only products[i].name (scripts/roles.ts proposeProductName, lib/product-name.ts), like every
//     config change from Studio. The title keeps the current name until it merges; the pencil gives way to
//     "Rename waiting for review".
// Self-hosted (pages/studio/products/[key].astro) the key comes from the build; on a team shell
// (pages/team-shell/products/item.astro) from the address, once the team's settings are read. Reads:
// scripts/product-page.ts.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { Badge, Button, IconButton, Input, Link, Skeleton, Tooltip } from '@bridge-ds/react';
import type { ProductConfig } from '@bridge-ds/core';
import { StudioHead } from './StudioHead';
import { Drawing } from './Drawing';
import StartExploration from './StartExploration';
import { ExplorationCardItem } from './ExplorationCards';
import { archivedHref, archivedLine, emptyProductLine, productFacts, productGroups, productKeyFromPath, productSummary } from '../../../lib/product-page';
import { studioHref } from '../../../lib/team-path';
import { PRODUCT_NAME_MAX, PRODUCT_NAME_WORDS, productNameProblem } from '../../../lib/product-name';
import type { ProductPageData } from '../../../scripts/product-page';
import type { HomeComponent } from './StudioHome';

/** Renaming the product, for an admin: what can be done now, and how to send it. Absent: read only. */
export interface ProductRename {
  /** 'offer': the pencil; 'waiting': a rename was sent and waits for review. */
  state: 'offer' | 'waiting';
  /** Sends the rename for review; rejects when it could not be sent. */
  onSend: (name: string) => Promise<void>;
}

export interface ProductPageViewProps {
  /** The key the page stands for. */
  productKey: string;
  data: ProductPageData | null;
  components: HomeComponent[];
  rename?: ProductRename | null;
}

/** The pencil after the title, the name in place while editing, or the rename waiting for review. */
function useRenameTitle(name: string, productKey: string, products: readonly { key: string; name: string }[], rename: ProductRename | null | undefined) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  const close = () => {
    setEditing(false);
    setError(null);
    // Back on the pencil (focus never lost), after it paints again.
    requestAnimationFrame(() => pencil.current?.focus());
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!rename || busy) return;
    const problem = productNameProblem(value, name, products, productKey);
    if (problem) {
      setError(problem);
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rename.onSend(value);
      setEditing(false);
      setNote(PRODUCT_NAME_WORDS.sent);
    } catch (err) {
      console.warn('Bridge: the product rename was not sent.', err);
      setError(PRODUCT_NAME_WORDS.refused);
    } finally {
      setBusy(false);
    }
  };
  if (!rename || !name) return { title: name || ' ', after: null, note: null };
  if (editing) {
    return {
      // The heading keeps the name for assistive tech while the field takes its place on screen.
      title: <span className="sr-only">{name}</span>,
      after: (
        <form className="pp-rename" onSubmit={(e) => void send(e)} noValidate>
          <Input
            ref={field}
            className="pp-rename-field"
            label={PRODUCT_NAME_WORDS.label}
            hideLabel
            value={value}
            maxLength={PRODUCT_NAME_MAX}
            autoComplete="off"
            error={error ?? undefined}
            onValueChange={(v: string) => {
              setValue(v);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) {
                e.preventDefault();
                close();
              }
            }}
          />
          <Button type="submit" variant="primary" loading={busy}>
            {PRODUCT_NAME_WORDS.save}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            {PRODUCT_NAME_WORDS.cancel}
          </Button>
        </form>
      ),
      note,
    };
  }
  return {
    title: name,
    after:
      rename.state === 'waiting' || note ? (
        <Badge tone="neutral">{PRODUCT_NAME_WORDS.waiting}</Badge>
      ) : (
        <Tooltip content="Rename">
          <IconButton
            ref={pencil}
            icon={Pencil}
            label={PRODUCT_NAME_WORDS.rename(name)}
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue(name);
              setError(null);
              setEditing(true);
            }}
          />
        </Tooltip>
      ),
    note,
  };
}

function Facts({ product, data }: { product: ProductConfig; data: ProductPageData }) {
  const f = productFacts(product, data.ownRepo, data.reached);
  // Only what a designer acts on: the live product, and the connection only when Bridge cannot reach it. The repository
  // and a healthy "Connected" are developer facts and noise here (Settings has them).
  const off = f.connection && !f.connection.ok ? f.connection.text : null;
  if (!f.production && !off) return null;
  return (
    <p className="t-ui t-muted pp-facts">
      {f.production && (
        <Link href={f.production.href} variant="subtle" external>
          Open the live product
        </Link>
      )}
      {off && <span className="pp-conn is-off">{off}</span>}
    </p>
  );
}

/** The page, painted from what is read so far. Pure render: tested in ProductPage.test.ts. */
export function ProductPageView({ productKey, data, components, rename }: ProductPageViewProps) {
  const product = data?.product ?? null;
  const head = useRenameTitle(product?.name ?? '', product?.key ?? productKey, data?.products ?? [], product ? rename : null);
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
        title={head.title}
        titleAfter={head.after}
        summary={loading && !cards.length ? '' : data?.failed ? '' : productSummary(cards)}
        // One primary action: on the title's line, or in the empty moment when there is nothing yet.
        actions={product && !empty ? start('menu') : null}
      >
        {product && data && <Facts product={product} data={data} />}
        <p className="t-ui t-muted pp-rename-note" role="status">
          {head.note}
        </p>
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
      {/* Archived ones are out of the lists: one quiet line, and the way to them on Changes' Archived tab. */}
      {archived.length > 0 && (
        <p className="t-ui t-muted pp-archived" data-archived-line="">
          <span>{archivedLine(archived.length)}</span> <Link href={archivedHref(product?.key ?? productKey)}>See archived</Link>
        </p>
      )}
    </div>
  );
}

/** The island: reads the product (the team's settings first on a team shell) and repaints as data lands. */
export default function ProductPage({ productKey, components = [] }: { productKey?: string; components?: HomeComponent[] }) {
  const [key] = useState(() => productKey ?? (typeof location !== 'undefined' ? productKeyFromPath(location.pathname) : null) ?? '');
  const [data, setData] = useState<ProductPageData | null>(null);
  const [comps, setComps] = useState<HomeComponent[]>(components);
  /** An admin of the team's repository, on a team shell, in a real team: may rename a product its settings list. */
  const [canRename, setCanRename] = useState(false);
  const [sent, setSent] = useState(false);
  /** The keys the team's own bridge.config.json lists (not the defaults Bridge shows without a list). */
  const [listedKeys, setListedKeys] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ isHosted }, { isSampleTeam }, { onAccess }, { repoContext }] = await Promise.all([
        import('../../../lib/team-path'),
        import('../../../lib/demo'),
        import('../../../scripts/github-session'),
        import('../../../scripts/repo-context'),
      ]);
      if (!isHosted()) return;
      onAccess((a) => {
        if (!live) return;
        const r = repoContext();
        // An admin signed in by email cannot send GitHub changes (the email proxy refuses them): read only, as in Settings.
        setCanRename(Boolean((a?.admin || a?.repoAdmin) && !(a?.contributor && a.admin)) && !isSampleTeam(`${r.owner}/${r.repo}`));
      });
    })();
    return () => {
      live = false;
    };
  }, []);
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
      const { siteConfig } = await import('../../../scripts/repo-context');
      if (live) setListedKeys(((siteConfig() as { products?: ProductConfig[] }).products ?? []).map((p) => p.key.toLowerCase()));
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
  // Only a product the team's own settings list can be renamed (not the defaults Bridge shows without a list).
  const listed = Boolean(data?.product && listedKeys.includes(data.product.key.toLowerCase()));
  const rename: ProductRename | null =
    canRename && listed && data?.product
      ? {
          state: sent ? 'waiting' : 'offer',
          onSend: async (to) => {
            const { proposeProductName } = await import('../../../scripts/roles');
            await proposeProductName({ key: data.product!.key, from: data.product!.name, to });
            setSent(true);
          },
        }
      : null;
  return <ProductPageView productKey={key} data={data} components={comps} rename={rename} />;
}
