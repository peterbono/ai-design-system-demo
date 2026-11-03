// Settings > Products on a team shell (pages/team-shell/settings): the products the team designs for, one row each,
// its name linking to its page, where its explorations happen in designer words, and Rename for an admin who may
// (lib/product-name canRenameProduct, a product the team's settings list: it opens the name in place on the product's
// page, #rename). "Add a product" at the foot, the same dialog as the setup step (AddProduct.tsx), for the admins it
// lets in. Facts only to who can act on them: the whole band is a lead's or an admin's (lib/create-branch
// libraryLead, an admin by email too); a designer gains nothing from it and never sees it. Never on the sample team.
// The repositories behind each product wait in "For developers". Words: lib/settings-view.ts PRODUCTS_WORDS.
import { useEffect, useState } from 'react';
import { Card, CardBody, Link } from '@bridge-ds/react';
import { productsOf, type ProductConfig } from '@bridge-ds/core';
import AddProduct from './AddProduct';
import { Code, DevFold } from './SettingsParts';
import { productHref } from '../../../lib/product-page';
import { PRODUCTS_WORDS as W, productDevValue, productSettingsLine } from '../../../lib/settings-view';

interface Facts {
  repo: string;
  /** What Studio shows (the defaults when the settings list none). */
  products: ProductConfig[];
  /** The keys the team's own settings list: only those can be renamed. */
  listed: string[];
  sample: boolean;
}

export default function TeamProducts() {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [lead, setLead] = useState(false);
  const [rename, setRename] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () =>
      void Promise.all([import('../../../scripts/repo-context'), import('../../../lib/demo')]).then(([{ repoContext, siteConfig }, { isSampleTeam }]) => {
        if (!live) return;
        const r = repoContext();
        const site = siteConfig() as { products?: ProductConfig[] };
        if (!Object.keys(site).length) return;
        const repo = `${r.owner}/${r.repo}`;
        setFacts({ repo, products: productsOf(site), listed: (site.products ?? []).map((p) => p.key.toLowerCase()), sample: isSampleTeam(repo) });
      });
    read();
    document.addEventListener('bridge:team-model', read);
    void Promise.all([import('../../../scripts/github-session'), import('../../../lib/create-branch'), import('../../../lib/product-name')])
      .then(([{ onAccess, designerRoute }, { libraryLead }, { canRenameProduct }]) => {
        onAccess((a) => {
          if (!live) return;
          // A lead or an admin (an email admin too), the same people who send a product its library update.
          setLead((libraryLead(a) && !designerRoute()) || Boolean(a?.admin));
          setRename(canRenameProduct(a, false));
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
      document.removeEventListener('bridge:team-model', read);
    };
  }, []);

  if (!facts || !lead || facts.sample) return null;
  return (
    <section className="ts-band" id="products" aria-labelledby="ts-products">
      <h2 id="ts-products" className="ts-h">
        {W.title}
      </h2>
      <p className="ts-intro">{W.intro}</p>
      <Card>
        <CardBody>
          <div className="set-rows">
            {facts.products.map((p) => (
              <div className="set-row" key={p.key} data-product-row={p.key}>
                <p className="set-row-label">
                  <Link href={productHref(p.key)}>{p.name}</Link>
                </p>
                <p className="set-row-value set-row-help">{productSettingsLine(p, facts.repo)}</p>
                <div className="set-row-action">
                  {/* Never the library itself: it keeps its name. */}
                  {rename && !p.default && facts.listed.includes(p.key.toLowerCase()) && (
                    <Link href={`${productHref(p.key)}#rename`} aria-label={W.renameLabel(p.name)}>
                      {W.rename}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="set-products-add">
            {/* The products the settings list (never Bridge's defaults): the new entry joins that list. */}
            <AddProduct products={facts.products.filter((p) => facts.listed.includes(p.key.toLowerCase()))} />
          </div>
          <DevFold
            facts={[
              ...facts.products.map((p) => ({ term: p.name, value: <Code>{productDevValue(p, facts.repo)}</Code> })),
              { term: 'Set in', value: <Code>{W.setIn}</Code> },
            ]}
          />
        </CardBody>
      </Card>
    </section>
  );
}
