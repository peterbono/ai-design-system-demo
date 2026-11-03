// "Add a product" (Settings > Products, the onboarding Products step, and the foot of Start an exploration's Where
// list, which opens this same dialog through `open`): an admin signed in with GitHub picks the
// product's code among what Bridge can see, names it, and keeps or drops the designers' copy. Bridge reads its
// previews from Vercel when it can, then proposes the new entry for review (scripts/roles.ts proposeNewProduct), the
// same path as a product rename. Words and rules: lib/add-product.ts. Never the sample team, never an email admin.
//
// "Product not in the list?" (Vercel's "Adjust GitHub App permissions"): GitHub opens in a small centered window on
// the page where the admin ticks which products Bridge sees. The dialog waits with a Field Guide drawing, reads the
// list again every few seconds (and at once when the return page, pages/studio/auth/access.astro, says so), and goes
// back to the form with the new product picked and named. GitHub closed with nothing new: one line says the owners
// decide (someone who does not own the account can only ask). GitHub busy: the busy line, no more reads.
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { Button, ButtonGroup, Checkbox, Combobox, Dialog, DialogClose, DialogContent, Input, Spinner } from '@bridge-ds/react';
import { accessSettingsUrl, type AppInstallation } from '../../../lib/access-view';
import { githubBusy } from '../../../lib/github-busy';
import type { ProductConfig } from '@bridge-ds/core';
import { BusyNotice } from './BusyNotice';
import { Drawing } from './Drawing';
import '../../../styles/add-product.css';
import {
  ACCESS_TICK_MS,
  ADD_PRODUCT_WORDS as W,
  accessStep,
  addProductProblem,
  foundLine,
  isAccessMessage,
  mergeRepos,
  nameFromRepo,
  newProductEntry,
  newRepoIn,
  nothingNewLine,
  popupFeatures,
  productKeyFor,
  waitedTooLong,
  type ProductRepoChoice,
} from '../../../lib/add-product';

/** Whether this viewer may add a product: the same rule as renaming one (lib/product-name canRenameProduct). */
export function useCanAddProduct(): boolean {
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
  /**
   * Opened from elsewhere (Start an exploration's "Add a product"): the dialog only, no button of its own. The opener
   * says what happens once it is sent (`onSent`).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function AddProduct({ products: given, variant = 'secondary', onSent, open: openProp, onOpenChange }: AddProductProps) {
  const can = useCanAddProduct();
  const controlled = openProp !== undefined;
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
  const [openOwn, setOpenOwn] = useState(false);
  const open = openProp ?? openOwn;
  const [sent, setSent] = useState(false);
  const [repos, setRepos] = useState<ProductRepoChoice[] | null>(null);
  const [target, setTarget] = useState<{ installation: AppInstallation | null; account: string } | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(true);
  const [previews, setPreviews] = useState<{ preview: string; production: string } | null | 'checking'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, go] = useReducer(accessStep, { kind: 'list' });
  // The new product that arrived from GitHub (announced once, until the admin picks something else).
  const [found, setFound] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  // The products listed when GitHub opened: anything else that shows up is the one the admin just gave access to.
  const before = useRef<string[]>([]);
  const sendRef = useRef<HTMLButtonElement>(null);
  const formId = useId();

  const setOpen = (o: boolean) => {
    if (!o) {
      go({ type: 'cancel' });
      setFound(null);
    }
    if (onOpenChange) onOpenChange(o);
    else setOpenOwn(o);
  };

  useEffect(() => {
    if (!open || repos) return;
    let live = true;
    void import('../../../scripts/add-product')
      .then((m) => m.readProductAccess(products))
      .then(
        (a) => {
          if (!live) return;
          setRepos(a.repos);
          setTarget({ installation: a.installation, account: a.account });
        },
        (err: unknown) => {
          if (!live) return;
          setRepos([]);
          const b = githubBusy(err);
          if (b) go({ type: 'busy', ...b });
        },
      );
    return () => {
      live = false;
    };
  }, [open, repos, products]);

  // One light read: a product that was not there when GitHub opened goes into the list, picked and named, GitHub's
  // window closes and the Add product button takes the focus. `last`: GitHub is closed, nothing new says so.
  const reading = useRef(false);
  const lastPending = useRef(false);
  const [rereading, setRereading] = useState(false);
  const readAgain = async (last: boolean) => {
    // One read at a time; GitHub's window closing during a read still gets its last read right after.
    if (reading.current) {
      if (last) lastPending.current = true;
      return;
    }
    reading.current = true;
    setRereading(true);
    try {
      const m = await import('../../../scripts/add-product');
      const now = await m.pollProductRepos(products, target?.installation?.id ?? null);
      go({ type: 'read' });
      const fresh = newRepoIn(before.current, now);
      if (fresh) {
        if (popup.current && !popup.current.closed) popup.current.close();
        popup.current = null;
        before.current = [...before.current, ...now.map((r) => r.full)];
        lastPending.current = false;
        setRepos((list) => mergeRepos(list ?? [], now));
        setRepo(fresh.full);
        setName(nameFromRepo(fresh.name));
        setError(null);
        setFound(cleanFoundName(fresh.name));
        go({ type: 'found' });
        return;
      }
      if (last) go({ type: 'closed' });
    } catch (err) {
      const b = githubBusy(err);
      if (b) go({ type: 'busy', ...b });
      else if (last) go({ type: 'closed' });
    } finally {
      reading.current = false;
      setRereading(false);
      if (lastPending.current) {
        lastPending.current = false;
        void readRef.current(true);
      }
    }
  };
  const readRef = useRef(readAgain);
  readRef.current = readAgain;

  // Waiting on GitHub: a read every few seconds while its window is open, one last read once it closes, none after
  // ten minutes. Coming back to this window, or the return page's message, reads at once.
  useEffect(() => {
    if (step.kind !== 'waiting') return;
    const timer = setInterval(() => {
      const w = popup.current;
      if (!w || w.closed || waitedTooLong(step, Date.now())) {
        clearInterval(timer);
        void readRef.current(true);
        return;
      }
      void readRef.current(false);
    }, ACCESS_TICK_MS);
    return () => clearInterval(timer);
  }, [step]);

  // While the dialog is open: the return page's message (this site only), and coming back after "Nothing new yet".
  useEffect(() => {
    if (!open) return;
    const onMessage = (e: MessageEvent) => {
      if (isAccessMessage(e, location.origin)) void readRef.current(false);
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible' && (step.kind === 'waiting' || step.kind === 'nothing-new')) void readRef.current(false);
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', onFocus);
    };
  }, [open, step]);

  // The new product is picked: the one next action takes the focus.
  useEffect(() => {
    if (found && step.kind === 'list') sendRef.current?.focus();
  }, [found, step.kind]);

  const giveAccess = () => {
    const url = accessSettingsUrl(target?.installation);
    // A centered window (the dialog keeps its place); blocked, a new tab. Never noopener: Bridge watches it close.
    const w = window.open(url, 'bridge-github-access', popupFeatures(window)) ?? window.open(url, '_blank');
    if (!w) return;
    popup.current = w;
    before.current = (repos ?? []).map((r) => r.full);
    setFound(null);
    go({ type: 'open', at: Date.now() });
  };

  const choice = repos?.find((r) => r.full === repo) ?? null;
  // Nothing to pick yet: the name and the copy choice wait until there is a product (progressive disclosure).
  const none = repos !== null && repos.length === 0;
  const waiting = step.kind === 'waiting';
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

  if (!can) return controlled || products.length ? null : <p className="set-row-value">{W.noneYet}</p>;
  if (sent && !controlled) return <p className="set-row-value" role="status">{W.sent}</p>;

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
      if (!controlled) setSent(true);
      onSent?.();
      setOpen(false);
    } catch {
      setError(W.refused);
    } finally {
      setBusy(false);
    }
  };

  // The line under the list (or, once GitHub closed with nothing new, what happened and Try again).
  const note =
    step.kind === 'nothing-new' ? (
      <p className="addp-more">
        <span>{nothingNewLine(target?.account)}</span>{' '}
        <Button variant="link" size="sm" loading={rereading} onClick={() => void readAgain(false)}>
          {W.tryAgain}
        </Button>
      </p>
    ) : (
      <p className="addp-more">
        <span>{W.notListed}</span>{' '}
        <Button variant="link" size="sm" onClick={giveAccess}>
          {W.giveAccess}
        </Button>
      </p>
    );

  return (
    <>
      {!controlled && (
        <Button variant={variant} onClick={() => setOpen(true)}>
          {W.open}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent
          title={W.title}
          description={W.lead}
          hideClose
          footer={
            <ButtonGroup align="end">
              {waiting ? (
                <Button variant="secondary" onClick={() => go({ type: 'cancel' })}>
                  {W.cancel}
                </Button>
              ) : (
                <DialogClose render={<Button variant="secondary" disabled={busy} />}>{W.cancel}</DialogClose>
              )}
              {!waiting && !none && (
                <Button ref={sendRef} type="submit" form={formId} variant="primary" loading={busy} disabled={busy || !repo}>
                  {W.send}
                </Button>
              )}
            </ButtonGroup>
          }
        >
          {waiting ? (
            <div className="addp-wait">
              <Drawing name="guide" width={96} className="addp-wait-art" />
              <div className="addp-wait-text">
                <p className="addp-wait-line" role="status">
                  {W.waiting}
                </p>
                <p className="addp-more">
                  <Spinner size="xs" /> <span>{W.waitingNote}</span>{' '}
                  <Button variant="link" size="sm" onClick={() => popup.current?.focus()}>
                    {W.showGitHub}
                  </Button>
                </p>
              </div>
            </div>
          ) : (
            <form id={formId} onSubmit={(e) => void submit(e)} noValidate className="addp-form">
              <div role="status" aria-live="polite" className="addp-found">
                {found && foundLine(found)}
              </div>
              {step.kind === 'busy' && <BusyNotice busy={{ resetsAt: step.resetsAt, source: step.source }} onRetry={() => void readAgain(false)} kept />}
              <div className="addp-pick">
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
                    setFound(null);
                    const r = repos?.find((x) => x.full === full);
                    if (r && !name.trim()) setName(nameFromRepo(r.name));
                  }}
                  emptyMessage={W.codeNone}
                />
                {repos && note}
              </div>
              {!none && (
                <>
                  <Input label={W.name} hint={W.nameHelp} value={name} onValueChange={(v) => setName(v)} autoComplete="off" />
                  <Checkbox label={W.copy} description={W.copyHelp} checked={copy} onCheckedChange={setCopy} />
                </>
              )}
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

/** The name the found line says: the readable one Bridge proposes. */
const cleanFoundName = (repoName: string) => nameFromRepo(repoName) || repoName;
