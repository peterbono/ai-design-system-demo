// "Add a product" (Settings > Products and the onboarding Products step): an admin signed in with GitHub picks the
// product's code among what Bridge can see, names it, and keeps or drops the designers' copy. Bridge reads its
// previews from Vercel when it can, then proposes the new entry for review (scripts/roles.ts proposeNewProduct), the
// same path as a product rename. Words and rules: lib/add-product.ts. Never the sample team, never an email admin.
import { useEffect, useId, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button, ButtonGroup, Checkbox, Combobox, Dialog, DialogClose, DialogContent, Input, Spinner } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { installUrl } from '../../../lib/access-view';
import type { ProductConfig } from '@bridge-ds/core';
import '../../../styles/add-product.css';
import { ADD_PRODUCT_WORDS as W, addProductProblem, nameFromRepo, newProductEntry, productKeyFor, type ProductRepoChoice } from '../../../lib/add-product';

/** Whether this viewer may add a product: the same rule as renaming one (lib/product-name canRenameProduct). */
function useCanAdd(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ isSampleTeam }, { onAccess }, { repoContext }, { canRenameProduct }] = await Promise.all([
        import('../../../lib/demo'),
        import('../../../scripts/github-session'),
        import('../../../scripts/repo-context'),
        import('../../../lib/product-name'),
      ]);
      onAccess((a) => {
        if (!live) return;
        const r = repoContext();
        setCan(canRenameProduct(a, isSampleTeam(`${r.owner}/${r.repo}`)));
      });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return can;
}

export interface AddProductProps {
  /** The products the team's settings list today; read from the team's settings when not given. */
  products?: ProductConfig[];
  /** `primary` in the onboarding step (its one action), `secondary` in Settings. */
  variant?: 'primary' | 'secondary';
  /** Called once the product is proposed. */
  onSent?: () => void;
}

export default function AddProduct({ products: given, variant = 'secondary', onSent }: AddProductProps) {
  const can = useCanAdd();
  const [read, setRead] = useState<ProductConfig[]>([]);
  useEffect(() => {
    if (given) return;
    let live = true;
    void import('../../../scripts/repo-context').then(({ siteConfig }) => live && setRead((siteConfig() as { products?: ProductConfig[] }).products ?? []));
    return () => {
      live = false;
    };
  }, [given]);
  const products = given ?? read;
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [repos, setRepos] = useState<ProductRepoChoice[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(true);
  const [previews, setPreviews] = useState<{ preview: string; production: string } | null | 'checking'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  useEffect(() => {
    if (!open || repos) return;
    let live = true;
    void import('../../../scripts/add-product')
      .then((m) => m.listProductRepos(products))
      .then((list) => live && setRepos(list), () => live && setRepos([]));
    return () => {
      live = false;
    };
  }, [open, repos, products]);

  // Nothing to pick: the admin gives the app access on GitHub in another tab; coming back reads the list again.
  useEffect(() => {
    if (!open || !repos || repos.length) return;
    const again = () => {
      if (document.visibilityState === 'visible') setRepos(null);
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [open, repos]);

  const choice = repos?.find((r) => r.full === repo) ?? null;
  // Nothing to pick yet: the one thing to do is give Bridge access on GitHub. The empty field, the name and the copy
  // choice wait until there is a product to pick (progressive disclosure), and the dialog has that one action.
  const none = repos !== null && repos.length === 0;
  useEffect(() => {
    if (!choice) return;
    let live = true;
    setPreviews('checking');
    void import('../../../scripts/add-product')
      .then((m) => m.detectPreviews(choice))
      .then((p) => live && setPreviews(p), () => live && setPreviews(null));
    return () => {
      live = false;
    };
  }, [choice]);

  if (!can) return products.length ? null : <p className="set-row-value">{W.noneYet}</p>;
  if (sent) return <p className="set-row-value" role="status">{W.sent}</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = addProductProblem({ name, repo }, products);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const entry = newProductEntry({
        key: productKeyFor(choice!.name, products.map((p) => p.key)),
        name,
        repo: choice!.full,
        copy,
        previews: previews === 'checking' ? null : previews,
      });
      const { proposeNewProduct } = await import('../../../scripts/roles');
      await proposeNewProduct(entry);
      setSent(true);
      setOpen(false);
      onSent?.();
    } catch {
      setError(W.refused);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {W.open}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent
          title={W.title}
          description={W.lead}
          hideClose
          footer={
            <ButtonGroup align="end">
              <DialogClose render={<Button variant="secondary" disabled={busy} />}>{W.cancel}</DialogClose>
              {!none && (
                <Button type="submit" form={formId} variant="primary" loading={busy} disabled={busy || !repo}>
                  {W.send}
                </Button>
              )}
            </ButtonGroup>
          }
        >
          {none ? (
            <div className="addp-form addp-none">
              <p className="addp-none-line">{W.codeNone}</p>
              <ButtonLink variant="primary" href={installUrl()} target="_blank" rel="noreferrer" iconEnd={ExternalLink} className="addp-access">
                {W.giveAccess}
              </ButtonLink>
            </div>
          ) : (
            <form id={formId} onSubmit={(e) => void submit(e)} noValidate className="addp-form">
              <Combobox
                label={W.code}
                hint={W.codeHelp}
                options={(repos ?? []).map((r) => ({ value: r.full, label: r.name, description: r.full }))}
                loading={!repos}
                loadingMessage={W.codeLoading}
                value={repo}
                onValueChange={(v) => {
                  const full = typeof v === 'string' ? v : null;
                  setRepo(full);
                  setError(null);
                  const r = repos?.find((x) => x.full === full);
                  if (r && !name.trim()) setName(nameFromRepo(r.name));
                }}
                emptyMessage={W.codeNone}
              />
              <Input label={W.name} hint={W.nameHelp} value={name} onValueChange={(v) => setName(v)} autoComplete="off" />
              <Checkbox label={W.copy} description={W.copyHelp} checked={copy} onCheckedChange={setCopy} />
              <div role="status" aria-live="polite" className="addp-status">
                {choice && previews === 'checking' && (
                  <>
                    <Spinner size="xs" /> {W.checking}
                  </>
                )}
                {choice && previews !== 'checking' && (previews ? W.previewsFound : W.previewsLater)}
              </div>
              {error && (
                <p className="addp-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
