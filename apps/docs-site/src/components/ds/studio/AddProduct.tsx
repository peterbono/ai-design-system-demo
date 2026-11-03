// "Add a product" (Settings > Products, the onboarding Products step, and the foot of Start an exploration's Where
// list, which opens this same dialog through `open`). Every entry opens on one question, "Which product does your team
// design for?", with two choice cards (Field Guide drawings): "It's already built" and "It's a new product". Never the
// sample team, never an email admin. Words and rules: lib/add-product.ts.
//
// Already built, Bridge sees products: "Pick your product" among them (named for the person, renamed later if
// needed), the designers' copy kept or dropped, Add product. Bridge reads its previews from Vercel when it can, then
// proposes the new entry for review (scripts/roles.ts proposeNewProduct), the same path as a product rename.
//
// Already built, Bridge sees none (or "Not in the list? Find it on GitHub"), Vercel's "Adjust GitHub App permissions":
// GitHub opens in a small centered window on the page where the admin ticks which products Bridge sees. The dialog
// waits with a Field Guide drawing, reads the list again every few seconds (and at once when the return page,
// pages/studio/auth/access.astro, says so), and goes back to the pick with the new product picked. "Not sure where it
// is? Ask a developer" copies a ready message with that page and the team's Studio. GitHub closed with nothing new: one
// line says the owners decide. GitHub busy: the busy line, no more reads.
//
// Someone who does not own the GitHub account (scripts/add-product readOwnership): before GitHub opens, one line says
// only its owners can show Bridge where it is and GitHub sends them the request, with "Copy a message for the owners".
// GitHub closed with nothing new: "Request sent to the owners", remembered in this browser per team (localStorage) so
// the dialog opens on it again; coming back to the window reads the list, and the approved product is picked.
//
// It's a new product: the same dialog shows StartNewProduct.tsx, where Bridge starts the product's code on GitHub
// itself, so no GitHub step, then shows the way to its previews. Back goes to the choice from every step.
import { forwardRef, useEffect, useId, useReducer, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, ButtonGroup, Checkbox, Combobox, Dialog, DialogClose, DialogContent, Spinner } from '@bridge-ds/react';
import { accessSettingsUrl, askDeveloperMessage, askOwnersMessage, requestAccessUrl, teamLink, type AppInstallation } from '../../../lib/access-view';
import { studioHref } from '../../../lib/team-path';
import { githubBusy } from '../../../lib/github-busy';
import type { ProductConfig } from '@bridge-ds/core';
import { BusyNotice } from './BusyNotice';
import { Drawing } from './Drawing';
import type { IllustrationName } from '../../../brand/illustrations';
import StartNewProduct from './StartNewProduct';
import { useCopy } from './TeamLink';
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
  nothingYetLine,
  ownersOnlyLine,
  parsePending,
  pendingKey,
  popupFeatures,
  requestSentLine,
  productKeyFor,
  productNameFor,
  waitedTooLong,
  type PendingRequest,
  type ProductRepoChoice,
} from '../../../lib/add-product';

/** The page's team ("owner/repo"), noted by useCanAddProduct: the dialog only shows once it is known. */
let pageTeam: string | null = null;

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
        pageTeam = `${r.owner}/${r.repo}`;
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
  // The name a product started from "It's a new product" keeps when it comes back to the pick (else Bridge names it).
  const [named, setNamed] = useState<string | null>(null);
  const [copy, setCopy] = useState(true);
  const [previews, setPreviews] = useState<{ preview: string; production: string } | null | 'checking'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, go] = useReducer(accessStep, { kind: 'list' });
  // The new product that arrived from GitHub (announced once, until the admin picks something else).
  const [found, setFound] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  // The products listed when GitHub opened: anything else that shows up is the one the admin just gave access to.
  // Null until GitHub opens (a read after "GitHub is busy" only fills the list).
  const before = useRef<string[] | null>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  // Which step: the choice (always first), "It's already built" (pick, find, wait) or "It's a new product"
  // (StartNewProduct.tsx). Once a new product is proposed, closing counts as sent.
  const [view, setView] = useState<'choice' | 'built' | 'new'>('choice');
  // The card the person chose last: Back puts the focus on it again.
  const chose = useRef<'built' | 'new'>('built');
  const proposedNew = useRef(false);
  // Whether the viewer owns the GitHub account (null: unknown, the usual words). Not an owner: GitHub only lets them
  // request, so the dialog says so before and after.
  const [owner, setOwner] = useState<boolean | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const asker = owner === false;
  const askerRef = useRef(asker);
  askerRef.current = asker;
  // The request kept for this team (this browser), shown as "Request sent" until the product arrives.
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const { copied, said, copy: copyText } = useCopy(3000);

  const setOpen = (o: boolean) => {
    if (!o) {
      go({ type: 'cancel' });
      setFound(null);
      setView('choice');
      if (proposedNew.current) {
        proposedNew.current = false;
        if (!controlled) setSent(true);
        onSent?.();
      }
    }
    if (onOpenChange) onOpenChange(o);
    else setOpenOwn(o);
  };

  useEffect(() => {
    if (!open || repos) return;
    let live = true;
    void import('../../../scripts/add-product')
      .then(async (m) => {
        const a = await m.readProductAccess(products);
        // Who can give access, once the account is known (one light read, kept for the page). It may answer after the
        // list is shown, so it only checks the dialog is still open. Never in the way of the list.
        Promise.resolve()
          .then(() => m.readOwnership(a.account, a.installation))
          .then((o) => openRef.current && setOwner(o), () => undefined);
        return a;
      })
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

  // A request this browser sent earlier: the approved product arrived (picked, as if found now), or "Request sent" again.
  const restored = useRef(false);
  useEffect(() => {
    if (!open) {
      restored.current = false;
      return;
    }
    // `can`: the page's team is known (useCanAddProduct notes it).
    if (!repos || !can || restored.current) return;
    restored.current = true;
    const kept = readPending();
    if (!kept) return;
    const fresh = newRepoIn(kept.before, repos);
    // The request is the dialog's news: it opens on "It's already built", not on the choice.
    setView('built');
    if (fresh) {
      forgetPending();
      setRepo(fresh.full);
      setNamed(null);
      setFound(cleanFoundName(fresh.name));
      return;
    }
    before.current = kept.before;
    setRequest(kept);
    go({ type: 'pending' });
  }, [open, repos, can]);

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
      const fresh = before.current ? newRepoIn(before.current, now) : null;
      if (!fresh) setRepos((list) => (list && newRepoIn(list.map((r) => r.full), now) ? mergeRepos(list, now) : (list ?? now)));
      if (fresh) {
        if (popup.current && !popup.current.closed) popup.current.close();
        popup.current = null;
        before.current = [...(before.current ?? []), ...now.map((r) => r.full)];
        lastPending.current = false;
        forgetPending();
        setRequest(null);
        setRepos((list) => mergeRepos(list ?? [], now));
        setRepo(fresh.full);
        setNamed(null);
        setError(null);
        setFound(cleanFoundName(fresh.name));
        go({ type: 'found' });
        return;
      }
      if (last) closeWithNothingNew();
    } catch (err) {
      const b = githubBusy(err);
      if (b) go({ type: 'busy', ...b });
      else if (last) closeWithNothingNew();
    } finally {
      reading.current = false;
      setRereading(false);
      if (lastPending.current) {
        lastPending.current = false;
        void readRef.current(true);
      }
    }
  };
  // GitHub closed with nothing new. Someone who could only request: the request is sent, remembered for this team.
  const closeWithNothingNew = () => {
    if (askerRef.current && target) {
      const kept: PendingRequest = { account: target.account, product: null, before: before.current ?? [], at: Date.now() };
      rememberPending(kept);
      setRequest(kept);
    }
    go({ type: 'closed', requested: askerRef.current });
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
      if (document.visibilityState === 'visible' && (step.kind === 'waiting' || step.kind === 'nothing-new' || step.kind === 'requested')) void readRef.current(false);
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
    // Not an owner: GitHub's own install page for the organization, where Save becomes a request.
    const url = asker ? requestAccessUrl(target?.installation) : accessSettingsUrl(target?.installation);
    // A centered window (the dialog keeps its place); blocked, a new tab. Never noopener: Bridge watches it close.
    const w = window.open(url, 'bridge-github-access', popupFeatures(window)) ?? window.open(url, '_blank');
    if (!w) return;
    popup.current = w;
    before.current = (repos ?? []).map((r) => r.full);
    setFound(null);
    go({ type: 'open', at: Date.now() });
  };

  const choice = repos?.find((r) => r.full === repo) ?? null;
  // No name field: Bridge names the product for the person (renamed later from its page if needed).
  const name = named ?? (choice ? productNameFor(choice, products) : '');
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

  // Moving between steps: the focus goes to the new step's first thing to do (Back: the card chosen before).
  const builtCard = useRef<HTMLButtonElement>(null);
  const newCard = useRef<HTMLButtonElement>(null);
  const findRef = useRef<HTMLButtonElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current || view === 'new') return;
    moved.current = false;
    const to = view === 'choice' ? (chose.current === 'built' ? builtCard : newCard).current : none ? findRef.current : pickRef.current;
    to?.focus();
  }, [view, none]);
  const show = (v: 'choice' | 'built' | 'new') => {
    if (v !== 'choice') chose.current = v;
    moved.current = true;
    setError(null);
    setView(v);
  };

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
      forgetPending();
      if (!controlled) setSent(true);
      onSent?.();
      setOpen(false);
    } catch {
      setError(W.refused);
    } finally {
      setBusy(false);
    }
  };

  // Someone who does not own the account: a ready-made message for the owners, with the page where they tick it, and
  // once the request is sent, Check again beside it.
  const account = request?.account ?? target?.account ?? '';
  const requested = step.kind === 'requested';
  const sentLine = requestSentLine(account, request?.product ?? null);
  const ownerActions = (
    <span className="addp-actions">
      <Button
        variant="link"
        size="sm"
        iconStart={copied ? Check : Copy}
        onClick={() => void copyText(askOwnersMessage(request?.product ?? null, accessSettingsUrl(target?.installation)), W.copiedForOwnersSaid)}
      >
        {copied ? W.copiedForOwners : W.copyForOwners}
      </Button>
      {requested && (
        <Button variant="link" size="sm" loading={rereading} onClick={() => void readAgain(false)}>
          {W.checkAgain}
        </Button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </span>
  );
  const forOwners = (
    <p className="addp-more">
      <span>{requested ? sentLine : ownersOnlyLine(account)}</span> {ownerActions}
    </p>
  );
  const nothingYet = (
    <p className="addp-more">
      <span>{nothingYetLine(target?.account)}</span>{' '}
      <Button variant="link" size="sm" loading={rereading} onClick={() => void readAgain(false)}>
        {W.tryAgain}
      </Button>
    </p>
  );

  // "Not sure where it is? Ask a developer": a ready message with the page where the product is ticked and the team's
  // Studio, where it then shows (the product is not known yet).
  const askDeveloper = (
    <p className="addp-more">
      <span>{W.notSure}</span>{' '}
      <Button
        variant="link"
        size="sm"
        iconStart={copied ? Check : undefined}
        onClick={() => void copyText(askDeveloperMessage(accessSettingsUrl(target?.installation), teamLink(location.origin, studioHref(''))), W.askDeveloperSaid)}
      >
        {copied ? W.copiedForOwners : W.askDeveloper}
      </Button>{' '}
      <span>{W.askDeveloperNote}</span>
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </p>
  );

  // Under the pick list: the way to a product Bridge cannot see yet (or, once GitHub closed with nothing new, what
  // happened and Try again).
  const note = requested ? (
    forOwners
  ) : step.kind === 'nothing-new' ? (
    nothingYet
  ) : (
    <>
      <p className="addp-more">
        <span>{W.notListed}</span>{' '}
        <Button variant="link" size="sm" onClick={giveAccess}>
          {W.findOnGitHub}
        </Button>
      </p>
      {asker && forOwners}
    </>
  );

  // Step 1: which product. Two cards, each a real button with its Field Guide drawing on a grey plate.

  const back = (
    <Button variant="secondary" disabled={busy} onClick={() => show('choice')}>
      {W.back}
    </Button>
  );

  const footer =
    view === 'choice' || waiting ? (
      <ButtonGroup align="end">
        {waiting ? (
          <Button variant="secondary" onClick={() => go({ type: 'cancel' })}>
            {W.cancel}
          </Button>
        ) : (
          <DialogClose render={<Button variant="secondary" />}>{W.cancel}</DialogClose>
        )}
      </ButtonGroup>
    ) : (
      <ButtonGroup align="end">
        {back}
        {none ? (
          <Button ref={findRef} variant="primary" iconEnd={ExternalLink} onClick={giveAccess}>
            {W.findOnGitHub}
          </Button>
        ) : (
          <Button ref={sendRef} type="submit" form={formId} variant="primary" loading={busy} disabled={busy || !repo}>
            {W.send}
          </Button>
        )}
      </ButtonGroup>
    );

  let body: React.ReactNode;
  if (view === 'choice') {
    body = (
      <div className="addp-choices">
        <ChoiceButton ref={builtCard} art="components" title={W.built} help={W.builtHelp} onClick={() => show('built')} />
        <ChoiceButton ref={newCard} art="fix" title={W.fresh} help={W.freshHelp} onClick={() => show('new')} />
      </div>
    );
  } else if (waiting) {
    // Step 4: GitHub is open. The dialog waits and reads again on its own.
    body = (
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
    );
  } else if (none) {
    // Step 3: Bridge sees none yet. One drawing, one sentence, Find it on GitHub in the footer.
    body = (
      <div className="addp-form">
        {step.kind === 'busy' && <BusyNotice busy={{ resetsAt: step.resetsAt, source: step.source }} onRetry={() => void readAgain(false)} kept />}
        <div className="addp-wait addp-find">
          <Drawing name="components" width={96} className="addp-wait-art" />
          <p className="addp-wait-line addp-find-line">{requested ? sentLine : W.findLine}</p>
        </div>
        {requested ? <p className="addp-more">{ownerActions}</p> : step.kind === 'nothing-new' ? nothingYet : asker ? forOwners : askDeveloper}
        {error && (
          <p className="addp-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  } else {
    // Step 2: pick it among the products Bridge sees.
    body = (
      <form id={formId} onSubmit={(e) => void submit(e)} noValidate className="addp-form">
        <div role="status" aria-live="polite" className="addp-found">
          {found && foundLine(found)}
        </div>
        {step.kind === 'busy' && <BusyNotice busy={{ resetsAt: step.resetsAt, source: step.source }} onRetry={() => void readAgain(false)} kept />}
        <div className="addp-pick">
          <Combobox
            ref={pickRef}
            label={W.pick}
            placeholder={W.pickPlaceholder}
            options={(repos ?? []).map((r) => ({ value: r.full, label: nameFromRepo(r.name) || r.name, description: r.full }))}
            loading={!repos}
            loadingMessage={W.codeLoading}
            value={repo}
            onValueChange={(v) => {
              setRepo(typeof v === 'string' ? v : null);
              setNamed(null);
              setError(null);
              setFound(null);
            }}
            emptyMessage={W.codeNone}
          />
          {repos && note}
        </div>
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
    );
  }

  return (
    <>
      {!controlled && (
        <Button variant={variant} onClick={() => setOpen(true)}>
          {W.open}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        {view === 'new' && (
          <StartNewProduct
            products={products}
            account={target?.account ?? null}
            repos={repos ?? []}
            busy={busy}
            setBusy={setBusy}
            onBack={() => show('choice')}
            onProposed={() => {
              proposedNew.current = true;
            }}
            onStartedOnly={(r, n) => {
              // Started on GitHub, not proposed: the pick with it picked, Add product sends it again.
              setRepos((list) => mergeRepos(list ?? [], [r]));
              setRepo(r.full);
              setNamed(n);
              setView('built');
              setError(W.refused);
            }}
            onDone={() => setOpen(false)}
          />
        )}
        {view !== 'new' && (
          <DialogContent
            title={view === 'choice' ? W.title : W.built}
            description={view === 'choice' ? W.question : undefined}
            hideClose
            footer={footer}
            // Back from "It's a new product" mounts this step again: the card chosen before takes the focus.
            initialFocus={view === 'choice' ? (chose.current === 'built' ? builtCard : newCard) : undefined}
          >
            {body}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/** One choice card: a real button, the drawing on its grey plate, the title as its name and the line as its description. */
const ChoiceButton = forwardRef<HTMLButtonElement, { art: IllustrationName; title: string; help: string; onClick: () => void }>(function ChoiceButton(
  { art, title, help, onClick },
  ref,
) {
  const id = useId();
  return (
    <button type="button" ref={ref} className="addp-choice" onClick={onClick} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      <span className="addp-choice-art">
        <Drawing name={art} width={88} />
      </span>
      <span className="addp-choice-text">
        <span id={`${id}-t`} className="addp-choice-title">
          {title}
        </span>
        <span id={`${id}-d`} className="addp-choice-help">
          {help}
        </span>
      </span>
    </button>
  );
});

// The request kept for the page's team, in this browser (a per-viewer convenience: never required, never shared).
function readPending(): PendingRequest | null {
  try {
    return pageTeam ? parsePending(localStorage.getItem(pendingKey(pageTeam)), Date.now()) : null;
  } catch {
    return null;
  }
}
function rememberPending(p: PendingRequest) {
  try {
    if (pageTeam) localStorage.setItem(pendingKey(pageTeam), JSON.stringify(p));
  } catch {
    /* storage refused: the dialog still says it this time */
  }
}
function forgetPending() {
  try {
    if (pageTeam) localStorage.removeItem(pendingKey(pageTeam));
  } catch {
    /* ignore */
  }
}

/** The name the found line says: the readable one Bridge proposes. */
const cleanFoundName = (repoName: string) => nameFromRepo(repoName) || repoName;
