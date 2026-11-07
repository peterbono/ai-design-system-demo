// Settings > Products on a team shell (pages/team-shell/settings): the products the team designs for, one row each,
// its name linking to its page, where its explorations happen in designer words, and Rename for an admin who may
// (lib/product-name canRenameProduct, a product the team's settings list: it opens the name in place on the product's
// page, #rename). "Add a product" on the title's line (it adds to the whole list, never to the last row), the same
// dialog as the setup step (AddProduct.tsx), for the admins it lets in. Facts only to who can act on them: the whole band is a lead's or an admin's (lib/create-branch
// libraryLead, an admin by email too); a designer gains nothing from it and never sees it. Never on the sample team.
// The repositories behind each product wait in "For developers". Words: lib/settings-view.ts PRODUCTS_WORDS.
import { useEffect, useState } from 'react';
import { Card, CardBody, Link, Select } from '@bridge-ds/react';
import type { TeamPeople, TeamPm } from '../../../scripts/contribute-session';
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
  // Who can be a product manager (anyone on the team, Can view is enough) and who is one, once read.
  const [people, setPeople] = useState<TeamPeople | null>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let unhook = () => undefined as void;
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
        let last: Parameters<Parameters<typeof onAccess>[0]>[0] = null;
        const paint = () => {
          if (!live) return;
          // A lead or an admin (an email admin too), the same people who send a product its library update. Who leads
          // is known once the team's settings are read: painted again then.
          setLead((libraryLead(last) && !designerRoute()) || Boolean(last?.admin));
          setRename(canRenameProduct(last, false));
        };
        onAccess((a) => {
          last = a;
          paint();
          if (!a || !live) return;
          void Promise.all([import('../../../scripts/github-session'), import('../../../scripts/contribute-session'), import('../../../scripts/repo-context')]).then(([{ getToken }, { contributeTeam }, { repoContext }]) => {
            const r = repoContext();
            const t = a.contributor ? null : getToken();
            setToken(t);
            contributeTeam(`${r.owner}/${r.repo}`, t).then(
              (x) => live && setPeople(x),
              () => undefined,
            );
          });
        });
        document.addEventListener('bridge:team-model', paint);
        unhook = () => document.removeEventListener('bridge:team-model', paint);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      unhook();
      document.removeEventListener('bridge:team-model', read);
    };
  }, []);

  if (!facts || !lead || facts.sample) return null;
  return (
    <section className="ts-band" id="products" aria-labelledby="ts-products">
      {/* Add a product acts on the whole list: on the title's line, as Invite collaborators is on Members' (proximity). */}
      <div className="ts-head">
        <div className="ts-head-text">
          <h2 id="ts-products" className="ts-h">
            {W.title}
          </h2>
          <p className="ts-intro">{W.intro}</p>
        </div>
        {/* The products the settings list (never Bridge's defaults): the new entry joins that list. */}
        <AddProduct products={facts.products.filter((p) => facts.listed.includes(p.key.toLowerCase()))} />
      </div>
      <Card>
        <CardBody>
          <div className="set-rows">
            {facts.products.map((p) => (
              <div className="set-row" key={p.key} data-product-row={p.key}>
                <p className="set-row-label">
                  <Link href={productHref(p.key)}>{p.name}</Link>
                </p>
                <div className="set-row-value">
                  <p className="set-row-help">{productSettingsLine(p, facts.repo)}</p>
                  {/* The library has no product manager: only the products the team designs for. */}
                  {!p.default && people && <PmPicker repo={facts.repo} product={p.key} people={people} token={token} onSaved={(pm) => setPeople((x) => (x ? { ...x, pms: withPm(x.pms, p.key, pm) } : x))} />}
                </div>
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

const withPm = (all: Record<string, TeamPm>, key: string, pm: TeamPm | null): Record<string, TeamPm> => {
  const { [key.toLowerCase()]: _was, ...rest } = all;
  return pm ? { ...rest, [key.toLowerCase()]: pm } : rest;
};

const pmValue = (pm: TeamPm | undefined): string => (!pm ? '' : 'login' in pm ? `login:${pm.login}` : `ref:${pm.ref}`);

/** The product manager of one product (board R2): anyone on the team, Can view is enough. Saved as soon as picked. */
export function PmPicker({ repo, product, people, token, onSaved }: { repo: string; product: string; people: TeamPeople; token: string | null; onSaved: (pm: TeamPm | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const options = [
    { value: '', label: W.noPm },
    ...people.members.filter((m) => m.ref).map((m) => ({ value: `ref:${m.ref}`, label: m.name })),
    ...people.collaborators.map((c) => ({ value: `login:${c.login}`, label: c.login })),
  ];
  return (
    <Select
      label={W.pm}
      hint={error ?? W.pmHint}
      size="sm"
      options={options}
      value={pmValue(people.pms[product.toLowerCase()])}
      onValueChange={(v) => {
        const pick = v ?? '';
        const next = pick.startsWith('ref:') ? { ref: pick.slice(4) } : pick.startsWith('login:') ? { login: pick.slice(6) } : null;
        setError(null);
        void import('../../../scripts/contribute-session')
          .then(({ setProductPm }) => setProductPm(repo, product, next, token))
          .then(onSaved, (e: Error) => setError(e.message));
      }}
    />
  );
}
