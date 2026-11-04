// "Add a product" (Settings > Products, the onboarding Products step, and the foot of Start an exploration's Where
// list, which opens this same dialog through `open`), validated board "Add a product v3" (owner-approved 2026-11-04,
// user flows AddProdFlows). One dialog, never the sample team, never an email member. Words and rules:
// lib/add-product.ts.
//
// D1: one question, "Where does it start from?", and three equal cards (Field Guide drawings): "Its code is on GitHub"
// (Recommended), "Only its address", "It's a new product". Details only after a choice; every next step has Back.
// A, "Its code is on GitHub": the products Bridge found on GitHub that the team does not have yet (never Bridge's own
// designers' copies, lib/add-product.ts isDesignCopy), one row each with Add, "Not in the list? Find it on GitHub" and
// "Give designers their own copy". Nothing found: one drawing, one line, and Find it on GitHub as the footer's primary.
// D2, "Only its address": its name and its address (StartNewProduct.tsx, kind address). Bridge starts the design
// team's own code for it from the product starter and keeps the address (ProductConfig.address).
// B, "It's a new product": its name and Create product (StartNewProduct.tsx).
//
// Add (and Create product) adds it to the team at once (scripts/add-product.ts addToTeam: Bridge writes it to the
// team's settings for an admin or a lead, api/_lib/product-add.ts), then the dialog closes and opens the product's
// page, already in the side nav. With "Give designers their own copy" ticked, that page makes the copy in the
// background with the adder's sign-in (lib/design-copy.ts noteCopySetup, ProductPage.tsx). A library where Bridge may
// not write it directly sends it for review instead, and the dialog says so plainly. Someone who may not add products reads why, from Bridge.
//
// Find it on GitHub (Vercel's "Adjust GitHub App permissions"): GitHub opens in a small centered window on the page
// where the team's account ticks which products Bridge sees (the team's account even when Bridge could not read its
// installation, never GitHub's account picker). The dialog waits with a Field Guide drawing, reads the list again
// every few seconds (and at once when the return page, pages/studio/auth/access.astro, says so), and shows the list
// with the new product announced. GitHub closed with nothing new: one line says the owners decide. GitHub busy: the
// busy line, no more reads. GitHub did not answer when the dialog opened: one line and Try again.
//
// Someone who does not own the GitHub account (scripts/add-product readOwnership): one line says only its owners can
// show Bridge where it is and GitHub sends them the request, with "Copy a message for the owners". GitHub closed with
// nothing new: "Request sent to the owners", remembered in this browser per team (localStorage), so the dialog opens
// on it again; coming back to the window reads the list, and the approved product is announced.
import { forwardRef, useEffect, useId, useReducer, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Badge, Button, ButtonGroup, Checkbox, Dialog, DialogClose, DialogContent, Spinner } from '@bridge-ds/react';
import type { IllustrationName } from '../../../brand/illustrations';
import { accessSettingsUrl, askOwnersMessage, requestAccessUrl, type AppInstallation } from '../../../lib/access-view';
import { githubBusy } from '../../../lib/github-busy';
import { noteCopySetup } from '../../../lib/design-copy';
import { productHref } from '../../../lib/product-page';
import type { ProductConfig } from '@bridge-ds/core';
import { BusyNotice } from './BusyNotice';
import { Drawing } from './Drawing';
import StartNewProduct from './StartNewProduct';
import type { PendingValues } from '../../../lib/pending-action';
import { useCopy } from './TeamLink';
import '../../../styles/add-product.css';
import {
  ACCESS_TICK_MS,
  ADD_PRODUCT_WORDS as W,
  accessStep,
  canAddProduct,
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

/** The dialog's steps: the first question, then one per card. */
type Mode = 'choice' | 'found' | 'address' | 'new';

/** The page's team ("owner/repo"), noted by useCanAddProduct: the dialog only shows once it is known. */
let pageTeam: string | null = null;

/**
 * Whether this viewer may add a product: an admin or a lead of the team signed in with GitHub (lib/add-product.ts
 * canAddProduct). Bridge checks it again before it writes anything.
 */
export function useCanAddProduct(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    let unhook = () => undefined as void;
    void (async () => {
      const [{ isSampleTeam }, session, { repoContext, siteConfig }] = await Promise.all([import('../../../lib/demo'), import('../../../scripts/github-session'), import('../../../scripts/repo-context')]);
      let last: Parameters<Parameters<typeof session.onAccess>[0]>[0] = null;
      const paint = () => {
        if (!live) return;
        const r = repoContext();
        pageTeam = `${r.owner}/${r.repo}`;
        setCan(canAddProduct(last, { sample: isSampleTeam(pageTeam), login: session.currentViewer()?.login ?? null, config: siteConfig() }));
      };
      session.onAccess((a) => {
        last = a;
        paint();
      });
      // A lead is known once the team's settings are read.
      document.addEventListener('bridge:team-model', paint);
      unhook = () => document.removeEventListener('bridge:team-model', paint);
    })().catch(() => undefined);
    return () => {
      live = false;
      unhook();
    };
  }, []);
  return can;
}

export interface AddProductProps {
  /** The products the team's settings list today; read from the team's settings when not given. */
  products?: ProductConfig[];
  /** `primary` in the onboarding step (its one action), `secondary` in Settings. */
  variant?: 'primary' | 'secondary';
  /** Called once the product is added (just before its page opens), or sent for review. */
  onSent?: () => void;
  /**
   * Opened from elsewhere (Start an exploration's "Add a product"): the dialog only, no button of its own. The opener
   * says what happens once it is sent (`onSent`).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Back from GitHub (a sign-in, or Install on GitHub; components/ds/studio/ResumeAction.tsx): the step the person was
   * on, with what they typed and one line on top ("Back from GitHub. Create Atlas now?"). Nothing is sent before they
   * click.
   */
  resume?: AddProductResume | null;
}

/** What Add a product reopens on after a trip to GitHub (scripts/resume.ts). */
export interface AddProductResume {
  kind: 'new-product' | 'add-product';
  values: PendingValues;
  line: string;
}

/** Opens the product's page once it is in the team (a full page: the side nav and the page read the new settings). */
let openPage = (href: string) => location.assign(href);
/** Tests replace the navigation. */
export const setOpenPage = (fn: (href: string) => void) => {
  openPage = fn;
};

export default function AddProduct({ products: given, variant = 'secondary', onSent, open: openProp, onOpenChange, resume = null }: AddProductProps) {
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
  const [target, setTarget] = useState<{ installation: AppInstallation | null; account: string; accountId: number | null } | null>(null);
  // GitHub did not answer the first read (not busy): the dialog says why, with Try again.
  const [unread, setUnread] = useState(false);
  const resumed = resume?.kind === 'add-product' ? resume.values : null;
  // Back from GitHub on a found product: its row, and the name the person gave it when it was started from a new one.
  const resumedRepo = typeof resumed?.repo === 'string' ? resumed.repo : null;
  const resumedName = typeof resumed?.name === 'string' && resumed.name ? resumed.name : null;
  const [copy, setCopy] = useState(typeof resume?.values.copy === 'boolean' ? resume.values.copy : true);
  // Back from GitHub: the line over the list, until the person adds or leaves.
  const [resumeNote, setResumeNote] = useState<string | null>(resume?.kind === 'add-product' ? resume.line : null);
  const [busy, setBusy] = useState(false);
  // The product being added (its row shows the spinner), and what went wrong, on its row.
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<{ repo: string | null; line: string } | null>(null);
  const [step, go] = useReducer(accessStep, { kind: 'list' });
  // The new product that arrived from GitHub (announced once, until the person adds something).
  const [found, setFound] = useState<{ repo: string; name: string } | null>(null);
  // Which step: the first question (D1), then its code on GitHub (A), only its address (D2) or a new product (B). Back
  // from GitHub reopens the step the person was on.
  const [mode, setMode] = useState<Mode>(resume ? (resume.kind === 'new-product' ? (typeof resume.values.address === 'string' ? 'address' : 'new') : 'found') : 'choice');
  // The card chosen last: Back puts the focus on it again.
  const chose = useRef<Exclude<Mode, 'choice'>>('found');
  const cardRefs = useRef(new Map<Exclude<Mode, 'choice'>, HTMLButtonElement>());
  const pick = (m: Mode) => {
    if (m !== 'choice') chose.current = m;
    setError(null);
    setMode(m);
  };
  // A product started from its address that is waiting in the list (it could not be added at once): Add sends it again
  // with its address. Back from GitHub on it: the same.
  const [startedAddress, setStartedAddress] = useState<{ repo: string; address: string } | null>(
    resumedRepo && typeof resumed?.address === 'string' ? { repo: resumedRepo, address: resumed.address } : null,
  );
  // Sent for review instead (a library where Bridge may not add it directly): the product's name.
  const [review, setReview] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  // The products listed when GitHub opened: anything else that shows up is the one the admin just gave access to.
  // Null until GitHub opens (a read after "GitHub is busy" only fills the list).
  const before = useRef<string[] | null>(null);
  const addRefs = useRef(new Map<string, HTMLButtonElement>());
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
      // Closed here: nothing to reopen after GitHub.
      void import('../../../scripts/pending-action').then((m) => m.forgetAction('add-product'), () => undefined);
      go({ type: 'cancel' });
      setFound(null);
      setError(null);
      setMode('choice');
      if (review) {
        setReview(null);
        if (!controlled) setSent(true);
      }
      // GitHub did not answer this time: the next opening asks again instead of keeping the empty list.
      if (unread) {
        setUnread(false);
        setRepos(null);
      }
    }
    if (onOpenChange) onOpenChange(o);
    else setOpenOwn(o);
  };

  // What Bridge sees on GitHub, and who can give it access. Both arrive together: the owners' line never shows up after
  // the step it belongs to. GitHub did not answer: the dialog says so with Try again, and the GitHub step still opens
  // on the team's account (its id read on its own), never GitHub's "Where do you want to install?".
  const load = async (isLive: () => boolean) => {
    const m = await import('../../../scripts/add-product');
    try {
      const a = await m.readProductAccess(products);
      // Bridge not knowing who owns the account keeps the usual words (null): never in the way of the list.
      const o = await Promise.resolve()
        .then(() => m.readOwnership(a.account, a.installation))
        .catch(() => null);
      if (!isLive()) return;
      setUnread(false);
      setOwner(o);
      setTarget({ installation: a.installation, account: a.account, accountId: a.accountId });
      setRepos(a.repos);
    } catch (err) {
      const t = await Promise.resolve()
        .then(() => m.teamAccount())
        .catch(() => null);
      if (!isLive()) return;
      if (t) setTarget({ installation: null, account: t.account, accountId: t.accountId });
      const b = githubBusy(err);
      setUnread(!b);
      setRepos([]);
      if (b) go({ type: 'busy', ...b });
    }
  };
  useEffect(() => {
    if (!open || repos) return;
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [open, repos, products]);
  // Try again after GitHub did not answer: the same read as on opening.
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await load(() => openRef.current);
    } finally {
      setRetrying(false);
    }
  };

  // A request this browser sent earlier: the approved product arrived (announced, as if found now), or "Request sent".
  const restored = useRef(false);
  useEffect(() => {
    if (!open) {
      restored.current = false;
      return;
    }
    // `can`: the page's team is known (useCanAddProduct notes it).
    if (!repos || !can || restored.current) return;
    restored.current = true;
    // Back from GitHub: the step the person was on wins over an older request.
    if (resume) return;
    const kept = readPending();
    if (!kept) return;
    const fresh = newRepoIn(kept.before, repos);
    if (fresh) {
      forgetPending();
      announce(fresh);
      return;
    }
    before.current = kept.before;
    setRequest(kept);
    // The request is the dialog's news: it opens on "Its code is on GitHub", not on the first question.
    setMode('found');
    go({ type: 'pending' });
  }, [open, repos, can]);

  /** A product that just arrived from GitHub: the list shows it, announced, its Add takes the focus. */
  const announce = (r: ProductRepoChoice) => {
    setMode('found');
    setError(null);
    setResumeNote(null);
    setFound({ repo: r.full, name: nameFromRepo(r.name) || r.name });
  };

  // One light read: a product that was not there when GitHub opened goes into the list, announced, GitHub's window
  // closes and its Add takes the focus. `last`: GitHub is closed, nothing new says so.
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
        void import('../../../scripts/pending-action').then((m) => m.forgetAction('add-product'), () => undefined);
        setRequest(null);
        setRepos((list) => mergeRepos(list ?? [], now));
        announce(fresh);
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

  // Back from GitHub on a found product: it goes in the list (a product Bridge just started may not be in GitHub's
  // list yet), and its Add takes the focus once the list is there. Nothing is sent before the click.
  const resumedFocus = useRef(false);
  useEffect(() => {
    if (!resumedRepo || resumedFocus.current || !repos) return;
    resumedFocus.current = true;
    if (/^[\w.-]+\/[\w.-]+$/.test(resumedRepo) && !repos.some((r) => r.full === resumedRepo)) {
      setRepos((list) => mergeRepos(list ?? [], [{ full: resumedRepo, name: resumedRepo.split('/')[1]!, defaultBranch: typeof resume?.values.branch === 'string' ? resume.values.branch : 'main' }]));
    }
    requestAnimationFrame(() => addRefs.current.get(resumedRepo)?.focus());
  }, [resumedRepo, repos]);
  // The card that opened a step left the page: the focus goes to the step's first action. Back puts it on that card
  // again. (A product announced, or back from GitHub, keeps its own focus below.)
  const findPrimary = useRef<HTMLButtonElement>(null);
  const focusedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      // Closed by its opener too (Start an exploration): the next opening starts from the question again.
      if (focusedFor.current !== null) setMode('choice');
      focusedFor.current = null;
      return;
    }
    const at = mode === 'found' ? (repos === null ? 'loading' : 'found') : mode;
    if (focusedFor.current === at || at === 'loading' || at === 'new' || at === 'address') {
      focusedFor.current = at;
      return;
    }
    const first = focusedFor.current === null;
    focusedFor.current = at;
    // On opening, the dialog puts the focus on its first card itself.
    if (first && at === 'choice') return;
    requestAnimationFrame(() => {
      if (at === 'choice') cardRefs.current.get(chose.current)?.focus();
      else if (!found && !resumedRepo) ((repos?.length ? addRefs.current.get(repos[0]!.full) : null) ?? findPrimary.current)?.focus();
    });
  }, [open, mode, repos === null]);
  // A product announced: its Add takes the focus.
  useEffect(() => {
    if (found && step.kind === 'list') requestAnimationFrame(() => addRefs.current.get(found.repo)?.focus());
  }, [found, step.kind]);

  // The page where the team's account ticks its products: its installation, else the app's install page for that
  // account (never GitHub's account picker when the account is known).
  const settingsUrl = () => accessSettingsUrl(target?.installation, undefined, target?.accountId);
  const giveAccess = () => {
    // Not an owner: GitHub's own install page for the organization, where Save becomes a request.
    const url = asker ? requestAccessUrl(target?.installation, undefined, target?.accountId) : settingsUrl();
    // A centered window (the dialog keeps its place); blocked, a new tab. Never noopener: Bridge watches it close.
    const w = window.open(url, 'bridge-github-access', popupFeatures(window)) ?? window.open(url, '_blank');
    if (!w) return;
    popup.current = w;
    // GitHub's page may come back in its own tab: its "Back to Studio" reopens this step there (scripts/pending-action).
    void import('../../../scripts/pending-action').then((m) => m.keepAction('add-product'), () => undefined);
    before.current = (repos ?? []).map((r) => r.full);
    setFound(null);
    go({ type: 'open', at: Date.now() });
  };

  if (!can) return controlled || products.length ? null : <p className="set-row-value">{W.noneYet}</p>;
  if (sent && !controlled) return <p className="set-row-value" role="status">{W.sent}</p>;

  /**
   * Adds the product to the team. Added: the dialog closes and its page opens (already in the side nav). Sent for
   * review instead: the dialog says so. Refused or not done: the reason on its row.
   */
  const addEntry = async (entry: ProductConfig): Promise<boolean> => {
    setBusy(true);
    setAdding(entry.repo ?? null);
    setError(null);
    setResumeNote(null);
    // Kept if the person has to sign in again first: this step reopens with the same product (scripts/pending-action).
    const { armPendingAction, disarmPendingAction } = await import('../../../scripts/pending-action');
    armPendingAction('add-product', { repo: entry.repo ?? null, name: entry.name, copy, ...(entry.address ? { address: entry.address } : {}) });
    try {
      const out = await (await import('../../../scripts/add-product')).addToTeam(entry);
      if (out.kind === 'added' || out.kind === 'review') {
        disarmPendingAction();
        forgetPending();
        onSent?.();
      }
      if (out.kind === 'added') {
        // The designers' copy was chosen here, once for the team: its page makes it in the background with this
        // sign-in, and designers never see a step for it.
        if (entry.design && pageTeam) noteCopySetup(typeof sessionStorage === 'undefined' ? null : sessionStorage, pageTeam, out.key, Date.now());
        setOpen(false);
        openPage(productHref(out.key));
        return true;
      }
      if (out.kind === 'review') {
        setReview(entry.name);
        return true;
      }
      setError({ repo: entry.repo ?? null, line: out.kind === 'refused' ? out.message : W.refused });
      return false;
    } catch (err) {
      // The sign-in expired: its sentence (signing in fixes it), not a generic refusal.
      setError({ repo: entry.repo ?? null, line: (await import('../../../scripts/resume')).signInLineFor(err, 'add products') ?? W.refused });
      return false;
    } finally {
      setBusy(false);
      setAdding(null);
    }
  };

  const addRepo = async (r: ProductRepoChoice) => {
    // Bridge names it (renamed later from its page if needed); a product started here keeps the name it was given.
    const name = r.full === resumedRepo && resumedName ? resumedName : productNameFor(r, products);
    // Started from its address and waiting here: it keeps its address.
    const address = startedAddress && startedAddress.repo.toLowerCase() === r.full.toLowerCase() ? startedAddress.address : null;
    setBusy(true);
    setAdding(r.full);
    const previews = await import('../../../scripts/add-product').then((m) => m.detectPreviews(r)).catch(() => null);
    await addEntry(newProductEntry({ key: productKeyFor(r.name, products.map((p) => p.key)), name, repo: r.full, copy, previews, address }));
  };

  // Someone who does not own the account: a ready-made message for the owners, with the page where they tick it, and
  // once the request is sent, Check again beside it.
  const account = request?.account ?? target?.account ?? '';
  const requested = step.kind === 'requested';
  const ownerActions = (
    <span className="addp-actions">
      <Button variant="link" size="sm" iconStart={copied ? Check : Copy} onClick={() => void copyText(askOwnersMessage(request?.product ?? null, settingsUrl()), W.copiedForOwnersSaid)}>
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
      <span>{requested ? requestSentLine(account, request?.product ?? null) : ownersOnlyLine(account)}</span> {ownerActions}
    </p>
  );
  const busyNotice = step.kind === 'busy' && <BusyNotice busy={{ resetsAt: step.resetsAt, source: step.source }} onRetry={() => void readAgain(false)} kept />;

  /**
   * The way to a product Bridge cannot see yet, under the list (A), or what happened with it: the request sent to the
   * owners, GitHub closed with nothing new, GitHub not answering. `lead` null: Find it on GitHub is the footer's
   * primary (nothing found), so only what happened shows here.
   */
  const findNote = (lead: string | null, action: string, onFind: () => void) => {
    if (requested) return forOwners;
    if (step.kind === 'nothing-new')
      return (
        <p className="addp-more">
          <span>{nothingYetLine(target?.account)}</span>{' '}
          <Button variant="link" size="sm" loading={rereading} onClick={() => void readAgain(false)}>
            {W.tryAgain}
          </Button>
        </p>
      );
    return (
      <>
        {unread && step.kind !== 'busy' && (
          <p className="addp-more">
            <span>
              {W.unreadLine} {W.unreadAction}
            </span>{' '}
            <Button variant="link" size="sm" loading={retrying} onClick={() => void retry()}>
              {W.tryAgain}
            </Button>
          </p>
        )}
        {lead !== null && (
          <p className="addp-more">
            <span>{lead}</span>{' '}
            <Button variant="link" size="sm" onClick={onFind}>
              {action}
            </Button>
          </p>
        )}
        {asker && forOwners}
      </>
    );
  };

  const cancel = <DialogClose render={<Button variant="secondary" disabled={busy} />}>{W.cancel}</DialogClose>;
  const back = (
    <Button variant="secondary" disabled={busy} onClick={() => pick('choice')}>
      {W.back}
    </Button>
  );
  const listed = repos ?? [];
  const view = review !== null ? 'review' : step.kind === 'waiting' ? 'waiting' : mode === 'found' && repos === null ? 'loading' : mode;

  let content: React.ReactNode;
  if (view === 'review') {
    content = (
      <DialogContent
        title={W.reviewTitle}
        description={W.reviewLine(review!)}
        hideClose
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="primary" />}>{W.done}</DialogClose>
          </ButtonGroup>
        }
      >
        <div className="addp-wait">
          <Drawing name="guide" width={96} className="addp-wait-art" />
        </div>
      </DialogContent>
    );
  } else if (view === 'waiting') {
    // GitHub is open. The dialog waits and reads again on its own.
    content = (
      <DialogContent
        title={W.github}
        hideClose
        footer={
          <ButtonGroup align="end">
            <Button variant="secondary" onClick={() => go({ type: 'cancel' })}>
              {W.cancel}
            </Button>
          </ButtonGroup>
        }
      >
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
      </DialogContent>
    );
  } else if (view === 'choice') {
    // D1: one question, three equal cards. Nothing else until the person picks one.
    content = (
      <DialogContent title={W.title} description={W.question} size="lg" hideClose footer={<ButtonGroup align="end">{cancel}</ButtonGroup>}>
        <div className="addp-choices">
          {(
            [
              { mode: 'found', art: 'components', title: W.github, help: W.githubHelp, recommended: true },
              { mode: 'address', art: 'address', title: W.address, help: W.addressHelp, recommended: false },
              { mode: 'new', art: 'fix', title: W.fresh, help: W.freshHelp, recommended: false },
            ] as const
          ).map((c) => (
            <ChoiceButton
              key={c.mode}
              ref={(el) => {
                if (el) cardRefs.current.set(c.mode, el);
                else cardRefs.current.delete(c.mode);
              }}
              art={c.art}
              title={c.title}
              help={c.help}
              badge={c.recommended ? W.recommended : null}
              onClick={() => pick(c.mode)}
            />
          ))}
        </div>
      </DialogContent>
    );
  } else if (view === 'loading') {
    content = (
      <DialogContent title={W.github} hideClose footer={<ButtonGroup align="end">{back}</ButtonGroup>}>
        <p className="addp-status" role="status">
          <Spinner size="xs" /> {W.codeLoading}
        </p>
      </DialogContent>
    );
  } else if (view === 'new' || view === 'address') {
    content = (
      <StartNewProduct
        key={view}
        kind={view}
        products={products}
        library={pageTeam}
        account={target?.account ?? null}
        busy={busy}
        setBusy={setBusy}
        copy={copy}
        onCopyChange={setCopy}
        onBack={() => pick('choice')}
        {...(resume?.kind === 'new-product' ? { resume: { values: resume.values, line: resume.line } } : {})}
        onAdd={async (entry, started) => {
          if (await addEntry(entry)) return;
          // Started on GitHub but not added: it waits in the list with the reason on its row; Add sends it again (with
          // its address when it was started from one).
          if (entry.address) setStartedAddress({ repo: started.full, address: entry.address });
          setRepos((list) => mergeRepos(list ?? [], [started]));
          setMode('found');
        }}
      />
    );
  } else {
    // A: the products Bridge found, one row each with its own Add. None found: one drawing, one line, and the way to
    // show Bridge where it is (the footer's primary).
    const none = !listed.length;
    content = (
      <DialogContent
        title={W.github}
        description={none ? undefined : W.foundLead}
        hideClose
        footer={
          <ButtonGroup align="end">
            {back}
            {none && !requested && (
              <Button ref={findPrimary} variant="primary" iconEnd={ExternalLink} disabled={busy} onClick={giveAccess}>
                {W.findOnGitHub}
              </Button>
            )}
          </ButtonGroup>
        }
      >
        <div className="addp-form">
          <div role="status" aria-live="polite" className="addp-found">
            {found ? foundLine(found.name) : resumeNote}
          </div>
          {busyNotice}
          {none ? (
            <div className="addp-wait addp-none">
              <Drawing name="components" width={96} className="addp-wait-art" />
              <p className="addp-wait-line addp-wait-text">{W.noneFound}</p>
            </div>
          ) : (
            <ul className="addp-rows">
              {listed.map((r) => {
                const label = nameFromRepo(r.name) || r.name;
                const failed = error && error.repo === r.full ? error.line : null;
                return (
                  <li key={r.full} className="addp-row" data-found={found?.repo === r.full ? '' : undefined}>
                    <span className="addp-row-main">
                      <span className="addp-row-text">
                        <span className="addp-row-name">{label}</span>
                        <span className="addp-row-repo">{r.full}</span>
                      </span>
                      <Button
                        ref={(el) => {
                          if (el) addRefs.current.set(r.full, el);
                          else addRefs.current.delete(r.full);
                        }}
                        variant="secondary"
                        aria-label={W.addLabel(label)}
                        loading={adding === r.full}
                        disabled={busy && adding !== r.full}
                        onClick={() => void addRepo(r)}
                      >
                        {W.add}
                      </Button>
                    </span>
                    {failed && (
                      <p className="addp-error" role="alert">
                        {failed}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {error && !error.repo && (
            <p className="addp-error" role="alert">
              {error.line}
            </p>
          )}
          {findNote(none ? null : W.notListed, W.findOnGitHub, giveAccess)}
          {!none && <Checkbox label={W.copy} description={W.copyHelp} checked={copy} onCheckedChange={setCopy} disabled={busy} />}
        </div>
      </DialogContent>
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
        {content}
      </Dialog>
    </>
  );
}

/**
 * One card of the first question: a real button, the drawing on its grey plate, the title as its name and the line as
 * its description; `badge` ("Recommended") in its corner, said with the name.
 */
const ChoiceButton = forwardRef<HTMLButtonElement, { art: IllustrationName; title: string; help: string; badge: string | null; onClick: () => void }>(function ChoiceButton(
  { art, title, help, badge, onClick },
  ref,
) {
  const id = useId();
  return (
    // bridge-audit-ignore-next-line: the whole card (drawing, title, line) is one target that opens its step, as on the validated board; the DS ChoiceCard is a radio (select, then confirm) and Button would cut it to one label
    <button type="button" ref={ref} className="addp-choice" data-recommended={badge ? '' : undefined} onClick={onClick} aria-labelledby={`${id}-t${badge ? ` ${id}-b` : ''}`} aria-describedby={`${id}-d`}>
      <span className="addp-choice-art">
        <Drawing name={art} width={88} />
      </span>
      <span className="addp-choice-text">
        {badge && (
          <Badge id={`${id}-b`} tone="neutral" appearance="solid" size="sm" className="addp-choice-badge">
            {badge}
          </Badge>
        )}
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
