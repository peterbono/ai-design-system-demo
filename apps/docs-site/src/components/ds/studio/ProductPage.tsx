// A product page of Studio (lib/product-page.ts), like a project in Figma: one page per product the team configures.
//   - The shared page header (StudioHead): the product's name, one live summary sentence ("2 exploring, 1 waiting for
//     code."), and "Start an exploration" at the end of the title's line, preselected with this product (the one start
//     flow, StartExploration). No drawing in the header: the action owns the end of the line.
//   - One quiet line under the header: "Open the live product", a warning only when Bridge cannot reach it, and, for a
//     product explored in the design team's copy (products[].design), "Art print shop changed since your copy. Get the
//     latest" only when the product moved on and the viewer can get it (anyone who can edit the team: GitHub write, or
//     an email member through Bridge, api/contribute merge-upstream); never the sentence without its action
//     (scripts/design-copy.ts, lib/design-copy.ts). For a product with its own repository, and only for a lead or an
//     admin (who can act on it), on the same line, which library it uses ("Art print shop uses the library from 1.8.3.
//     The latest is 1.8.4.") and "Send the update to the developers"; once sent, "Update sent to the developers." with
//     "Open their update" for people signed in with GitHub (lib/library-update.ts, scripts/library-update.ts). Nobody
//     else reads it, so nobody else reads the product's library either. Never on the sample team.
//   - The designers' copy is a one-time team setup the admin chose in Add a product: nobody ever sees "Make my copy".
//     Right after the add, for the admin or lead who added it (this browser only), Bridge makes it in the background
//     with their sign-in: one quiet line, "Getting a copy ready for your designers…", then nothing; if it fails, the
//     line says so calmly with Try again; if only a tick on GitHub lets Bridge open it, the one more step
//     (CopyAccessStep) under the way to start, for an admin only. A product without a copy otherwise reads like any
//     other: "Start an exploration" makes the copy first (StartExploration.tsx).
//   - Its explorations, grouped by where they stand (Exploring, Waiting for code, Being built, In review, Shipped: the lifecycle's words), each
//     the exploration card of the home (ExplorationCards.tsx); archived ones only counted in one quiet line at the end
//     ("1 archived. See archived"), which opens Changes' Archived tab for this product.
//   - Nothing explored yet: a calm Field Guide drawing, shown at once, the reason in one sentence and the one action.
//   - GitHub busy for the viewer (lib/github-busy): what was last read stays, with one calm line ("GitHub is busy for
//     your account. Bridge is back at 13:52.") and Try again; nothing kept: the same sentence as a calm moment in place
//     of the list. Never "Product not found" or "Nothing explored here yet" while busy. The page reads
//     again once on its own after the reset (BusyNotice).
//   - More actions (admins of the team's repository, on a team shell or the team's own Studio, never the sample team,
//     never the library): one "..." DS IconButton at the end of the title's line, a DS Menu with the rare actions
//     (progressive disclosure, no pencil always in view). Viewers see no menu.
//       Rename: the name opens in place (a DS Input, Save, Escape cancels). Save sends the config pull request that
//       changes only products[i].name (scripts/roles.ts proposeProductName, lib/product-name.ts), like every config
//       change from Studio. The title keeps the current name until it merges; "Rename waiting for review" after it.
//       Settings > Products' Rename opens the page with #rename: the name opens in place.
//       Remove from Bridge (danger, last): a confirm dialog that says nothing is deleted on GitHub and asks for the
//       product's name, typed exactly (the Delete team pattern). It sends the config pull request that drops only
//       products[i] (scripts/roles.ts proposeProductRemoval, lib/remove-product.ts). Never a repository delete.
//     The library itself is never renamed nor removed: no menu on its page.
// Self-hosted (pages/studio/products/[key].astro) the key comes from the build; on a team shell
// (pages/team-shell/products/item.astro) from the address, once the team's settings are read. Reads:
// scripts/product-page.ts.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronRight, Ellipsis, Pencil, Unplug } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  Dialog,
  DialogClose,
  DialogContent,
  Icon,
  IconButton,
  Input,
  Link,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Spinner,
} from '@bridge-ds/react';
import type { ProductConfig } from '@bridge-ds/core';
import { StudioHead } from './StudioHead';
import { Drawing } from './Drawing';
import type { IllustrationName } from '../../../brand/illustrations';
import StartExploration from './StartExploration';
import { ExplorationCardItem } from './ExplorationCards';
import { LIBRARY_ASKS, archivedHref, archivedLine, emptyProductLine, productFacts, signedOutProductLine, productGroups, productKeyFromPath, productSummary } from '../../../lib/product-page';
import { studioHref } from '../../../lib/team-path';
import { PRODUCT_NAME_MAX, PRODUCT_NAME_WORDS, productNameProblem } from '../../../lib/product-name';
import { REMOVE_PRODUCT_WORDS, removeConfirmMatches } from '../../../lib/remove-product';
import { COPY_SETUP_WORDS, COPY_WORDS, latestLine, needsCopyAccess, setupLine, showsBehind, type CopyAccess, type CopyOutcome } from '../../../lib/design-copy';
import { CopyAccessStep } from './CopyAccessStep';
import type { ProductPageData } from '../../../scripts/product-page';
import { LIBRARY_UPDATE_WORDS, libraryLine, type LibraryLine } from '../../../lib/library-update';
import type { LibraryView } from '../../../scripts/library-update';
import type { GitHubBusy } from '../../../lib/github-busy';
import type { HomeComponent } from './StudioHome';
import { BusyNotice } from './BusyNotice';
import { ProductPreviewsStep } from './ProductPreviewsStep';
import { isTeamAdmin, previewsStep, showsPreviewsStep, type PreviewsLike, type PreviewsStep } from '../../../lib/product-previews';

/** Renaming the product, for an admin: what can be done now, and how to send it. Absent: read only. */
export interface ProductRename {
  /** 'offer': Rename in the More actions menu; 'waiting': a rename was sent and waits for review. */
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
  /** Removing the product from Bridge, for an admin (never the library). Absent: no Remove. */
  remove?: ProductRemove | null;
  /** Get the latest into the team's copy: absent for a viewer who cannot. */
  copy?: CopyActions | null;
  /**
   * The designers' copy Bridge makes right after Add a product, for the admin or lead who added it. Absent for
   * everyone else, and once the copy is there.
   */
  copySetup?: CopySetup | null;
  /** Whether the viewer may change the library (create-branch libraryLead): false for a designer of the team. */
  lead?: boolean;
  /** Reads the page again (GitHub busy: Try again, and once on its own after the reset). */
  onRetry?: () => void;
  /** Signed in: GitHub's wait is "for your account". */
  signedIn?: boolean;
  /** Nobody is signed in: a product Bridge cannot read for them says to sign in, never that nothing was explored. */
  visitor?: boolean;
  /** The library line (lib/library-update libraryLine): how far behind the product is, and the update to send. */
  library?: LibraryUpdate | null;
  /**
   * "One step before the first preview" (lib/product-previews.ts): set only for an admin, on a product with no
   * previews yet. Absent: nothing, not even a hint.
   */
  previews?: PreviewsStep | null;
}

/** Removing the product from Bridge, for an admin: what can be done now, and how to send it. */
export interface ProductRemove {
  /** 'offer': Remove from Bridge in the More actions menu; 'waiting': a removal was sent and waits for review. */
  state: 'offer' | 'waiting';
  /** Sends the removal for review (the config only, never the product's repository); rejects when it could not be sent. */
  onSend: () => Promise<void>;
}

/** The library line of a product with its own repository, and the update a lead or an admin sends. */
export interface LibraryUpdate {
  line: LibraryLine;
  /** Sends the update to the developers; rejects with Bridge's words. Absent: the viewer may not. */
  send?: () => Promise<void>;
}

/**
 * The name in place while editing (opened from More actions' Rename), or the rename waiting for review. `back`: where
 * focus returns once the field closes (the More actions button).
 */
function useRenameTitle(
  name: string,
  productKey: string,
  products: readonly { key: string; name: string }[],
  rename: ProductRename | null | undefined,
  back: { current: HTMLElement | null },
) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Back from GitHub (a sign-in): the line under the field, Save focused (nothing sent before the click).
  const [resumeLine, setResumeLine] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const resumed = useRef(false);
  useEffect(() => {
    // The menu hands focus back to its button as it closes: the field takes it again on the next frame.
    if (!editing) return;
    const to = resumed.current ? saveRef : field;
    resumed.current = false;
    to.current?.focus();
    const id = requestAnimationFrame(() => to.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [editing]);
  // Settings > Products' Rename (TeamProducts.tsx) lands here with #rename: the name opens in place, once.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !rename || rename.state !== 'offer' || !name || typeof location === 'undefined' || location.hash !== '#rename') return;
    asked.current = true;
    setValue(name);
    setEditing(true);
  }, [rename, name]);
  const close = () => {
    setEditing(false);
    setError(null);
    setResumeLine(null);
    // Back on More actions (focus never lost), after it paints again.
    requestAnimationFrame(() => back.current?.focus());
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
    setResumeLine(null);
    try {
      await rename.onSend(value);
      setEditing(false);
      setNote(PRODUCT_NAME_WORDS.sent);
    } catch (err) {
      console.warn('Bridge: the product rename was not sent.', err);
      // The sign-in expired: its sentence (signing in fixes it), not a generic refusal.
      setError((await import('../../../scripts/resume')).signInLineFor(err, 'rename it') ?? PRODUCT_NAME_WORDS.refused);
    } finally {
      setBusy(false);
    }
  };
  const start = () => {
    setValue(name);
    setError(null);
    setEditing(true);
  };
  /** Back from GitHub: the name typed before, the line, Save focused. */
  const resume = (to: string, line: string) => {
    resumed.current = true;
    setValue(to);
    setError(null);
    setResumeLine(line);
    setEditing(true);
  };
  if (!rename || !name) return { title: name || ' ', after: null, note: null, editing: false, canRename: false, start, resume };
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
            hint={resumeLine ?? undefined}
            onValueChange={(v: string) => {
              setValue(v);
              setError(null);
              setResumeLine(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !busy) {
                e.preventDefault();
                close();
              }
            }}
          />
          <Button ref={saveRef} type="submit" variant="primary" loading={busy}>
            {PRODUCT_NAME_WORDS.save}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            {PRODUCT_NAME_WORDS.cancel}
          </Button>
        </form>
      ),
      note,
      editing: true,
      canRename: false,
      start,
      resume,
    };
  }
  const waiting = rename.state === 'waiting' || Boolean(note);
  return {
    title: name,
    after: waiting ? <Badge tone="neutral">{PRODUCT_NAME_WORDS.waiting}</Badge> : null,
    note,
    editing: false,
    canRename: !waiting,
    start,
    resume,
  };
}

/**
 * "Remove from Bridge?": what it does in plain words (Bridge deletes nothing on GitHub), and the product's name typed
 * exactly before the danger button turns on (the Delete team pattern, DeleteTeam.tsx).
 */
function RemoveProductDialog({
  name,
  open,
  onOpenChange,
  onSend,
  resume = null,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: () => Promise<void>;
  /** Back from GitHub (a sign-in): the name typed before and the line; Remove waits for the click. */
  resume?: { typed: string; line: string } | null;
}) {
  const W = REMOVE_PRODUCT_WORDS;
  const [typed, setTyped] = useState('');
  const [resumeLine, setResumeLine] = useState<string | null>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!resume) return;
    setTyped(resume.typed);
    setResumeLine(resume.line);
  }, [resume]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const ok = removeConfirmMatches(typed, name);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    setResumeLine(null);
    try {
      await onSend();
      setTyped('');
      onOpenChange(false);
    } catch (err) {
      console.warn('Bridge: the product removal was not sent.', err);
      setError((await import('../../../scripts/resume')).signInLineFor(err, 'remove it') ?? W.refused);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) {
          setTyped('');
          setError(null);
          setResumeLine(null);
        }
      }}
    >
      <DialogContent
        title={W.title(name)}
        description={W.text(name)}
        size="sm"
        hideClose
        initialFocus={resumeLine ? removeRef : undefined}
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="secondary" disabled={busy} />}>{W.cancel}</DialogClose>
            <Button ref={removeRef} type="submit" form={formId} variant="danger" loading={busy} disabled={!ok || busy}>
              {W.remove}
            </Button>
          </ButtonGroup>
        }
      >
        <form id={formId} className="pp-remove-form" noValidate onSubmit={(e) => void submit(e)}>
          <p className="t-body pp-remove-safe">{W.safe}</p>
          <Input label={W.confirmLabel(name)} name="confirm" autoComplete="off" spellCheck={false} value={typed} onValueChange={setTyped} />
          {resumeLine && !error && (
            <p className="t-body" role="status">
              {resumeLine}
            </p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * More actions for the product, at the end of the title's line: the rare actions, on demand (Rename, then Remove from
 * Bridge, the danger item last after a separator). Null when the viewer has none left to take.
 */
function ProductMenu({ name, rename, remove, onRename, onRemove, trigger }: { name: string; rename: boolean; remove: boolean; onRename: () => void; onRemove: () => void; trigger: { current: HTMLButtonElement | null } }) {
  if (!rename && !remove) return null;
  return (
    <Menu>
      <MenuTrigger render={<IconButton ref={trigger} icon={Ellipsis} label={REMOVE_PRODUCT_WORDS.more(name)} variant="secondary" data-product-menu="" />} />
      <MenuContent align="end">
        {rename && (
          <MenuItem icon={Pencil} onClick={onRename}>
            {REMOVE_PRODUCT_WORDS.rename}
          </MenuItem>
        )}
        {rename && remove && <MenuSeparator />}
        {remove && (
          <MenuItem tone="danger" icon={Unplug} onClick={onRemove}>
            {REMOVE_PRODUCT_WORDS.remove}
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

/**
 * The copy action of the island (scripts/design-copy.ts), answering the sentence to show. Absent when the viewer may
 * not: getting the latest is for anyone who can edit the team.
 */
export interface CopyActions {
  latest?: (() => Promise<string>) | null;
}

/**
 * The designers' copy Bridge makes right after Add a product (the admin or lead who added it): being made (the quiet
 * line), not made (the reason and Try again), or made but Bridge may not open it yet (the one more step, an admin's).
 */
export type CopySetup =
  | { kind: 'making' }
  | { kind: 'failed'; line: string; retry: () => void }
  | { kind: 'access'; access: CopyAccess; onVisible: () => Promise<void> };

/** The quiet line under the header while Bridge makes the copy, or why it could not, with Try again. */
function CopySetupLine({ setup }: { setup: CopySetup }) {
  if (setup.kind === 'access') return null;
  return (
    <p className="t-ui t-muted pp-facts pp-setup" data-copy-setup={setup.kind}>
      {setup.kind === 'making' && <Spinner size="xs" />}
      <span role="status">{setup.kind === 'making' ? COPY_SETUP_WORDS.making : setup.line}</span>
      {setup.kind === 'failed' && (
        <Button variant="link" size="sm" onClick={setup.retry}>
          {COPY_SETUP_WORDS.tryAgain}
        </Button>
      )}
    </p>
  );
}

/**
 * "Art print shop uses the library from 1.8.3. The latest is 1.8.4." and, on the same line, the one thing to do:
 * "Send the update to the developers" (a lead or an admin), or "Update sent to the developers." with "Open their
 * update" for people signed in with GitHub. No package name, lockfile or pull request in a designer's words.
 */
function LibraryFact({ library }: { library: LibraryUpdate }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { line } = library;
  const send = async () => {
    if (!library.send || sending) return;
    setSending(true);
    setError(null);
    try {
      await library.send();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : LIBRARY_UPDATE_WORDS.failed);
    } finally {
      setSending(false);
    }
  };
  return (
    <span className="pp-behind pp-library" data-library-line="">
      <span>{line.text}</span>
      {line.send && library.send && (
        <Button variant="link" size="sm" loading={sending} onClick={() => void send()}>
          {LIBRARY_UPDATE_WORDS.send}
        </Button>
      )}
      {line.sent && <span data-library-sent="">{LIBRARY_UPDATE_WORDS.sent}</span>}
      {line.sent && line.link && (
        <Link href={line.link} variant="subtle" external>
          {LIBRARY_UPDATE_WORDS.open}
        </Link>
      )}
      {/* Did not happen: said in the danger text color, not as one more quiet fact. */}
      <span role="status" aria-live="polite" className={error ? 'pp-error' : undefined}>
        {error}
      </span>
    </span>
  );
}

function Facts({ product, data, copy, library }: { product: ProductConfig; data: ProductPageData; copy?: CopyActions | null; library?: LibraryUpdate | null }) {
  const f = productFacts(product, data.ownRepo, data.reached);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // Only what a designer acts on: the live product, the connection only when Bridge cannot reach it, and "Get the
  // latest" only when the product moved on since the team's copy and the viewer can get it (never the sentence alone).
  // The repository and a healthy "Connected" are developer facts and noise here (Settings has them).
  // A product explored in the designers' copy: the developers' repository is never where designers work, so whether
  // Bridge reaches it is not theirs to read here (the copy is Bridge's to make, from the start flow).
  const off = f.connection && !f.connection.ok && !data.copy && !product.design?.repo ? f.connection.text : null;
  const behind = showsBehind(data.copy) && !said && Boolean(copy?.latest);
  if (!f.production && !off && !behind && !said && !library) return null;
  const latest = async () => {
    if (!copy?.latest || busy) return;
    setBusy(true);
    try {
      setSaid(await copy.latest());
    } finally {
      setBusy(false);
    }
  };
  return (
    <p className="t-ui t-muted pp-facts">
      {f.production && (
        <Link href={f.production.href} variant="subtle" external>
          Open the live product
        </Link>
      )}
      {off && <span className="pp-conn is-off">{off}</span>}
      {behind && (
        <span className="pp-behind" data-copy-behind="">
          {COPY_WORDS.behind(product.name)}{' '}
          <Button variant="link" size="sm" loading={busy} onClick={() => void latest()}>
            {COPY_WORDS.getLatest}
          </Button>
        </span>
      )}
      {copy && <span aria-live="polite">{said}</span>}
      {library && <LibraryFact library={library} />}
    </p>
  );
}

/**
 * The Home's way to start (StudioHome Start): a white card in the zone, the drawing, the title in Harbor and one line;
 * the whole card is the action, and the chevron says so on hover and focus. The one shape of the empty slot: Start an
 * exploration and a designer's asks on the library read the same, at the same size.
 */
function choiceCard(drawing: IllustrationName, title: ReactNode, line: ReactNode) {
  return (
    <Card interactive className="sh-choice pp-choice">
      <CardBody className="sh-choice-body pp-choice-body">
        <Drawing name={drawing} width={88} />
        <span className="sh-choice-text">
          {title}
          {typeof line === 'string' ? <span className="t-ui t-muted">{line}</span> : line}
        </span>
        <Icon icon={ChevronRight} size="md" className="pp-choice-go" />
      </CardBody>
    </Card>
  );
}

/** The page, painted from what is read so far. Pure render: tested in ProductPage.test.ts. */
export function ProductPageView({
  productKey,
  data,
  components,
  rename,
  remove = null,
  copy,
  copySetup = null,
  lead = true,
  onRetry = () => location.reload(),
  signedIn = true,
  visitor = false,
  library: libraryUpdate = null,
  previews = null,
}: ProductPageViewProps) {
  const product = data?.product ?? null;
  // The library itself is never renamed nor removed: no More actions on its page.
  const own = product && !product.default ? product : null;
  const menuButton = useRef<HTMLButtonElement>(null);
  const head = useRenameTitle(product?.name ?? '', product?.key ?? productKey, data?.products ?? [], own ? rename : null, menuButton);
  const [removing, setRemoving] = useState(false);
  const [removeNote, setRemoveNote] = useState<string | null>(null);
  // Back from GitHub (a sign-in, scripts/pending-action.ts): the rename or the removal of this product
  // reopens with what was typed. Taken once, only for this product, only by someone who may still do it.
  const [removeResume, setRemoveResume] = useState<{ typed: string; line: string } | null>(null);
  const resumeAsked = useRef(false);
  const renameOffer = Boolean(own && rename && rename.state === 'offer');
  const removeOffer = Boolean(own && remove && remove.state === 'offer');
  const ownKey = own?.key ?? null;
  useEffect(() => {
    if (!(renameOffer || removeOffer) || !ownKey || resumeAsked.current) return;
    resumeAsked.current = true;
    void Promise.all([import('../../../scripts/pending-action'), import('../../../scripts/resume')])
      .then(([{ peekPendingAction }, { takeResume }]) => {
        const kept = peekPendingAction();
        if (!kept || kept.values.key !== ownKey) return;
        if (!((kept.kind === 'rename-product' && renameOffer) || (kept.kind === 'remove-product' && removeOffer))) return;
        const r = takeResume(kept.kind);
        if (!r) return;
        if (r.action.kind === 'rename-product') head.resume(typeof r.action.values.to === 'string' ? r.action.values.to : '', r.line);
        else {
          setRemoveResume({ typed: typeof r.action.values.name === 'string' ? r.action.values.name : '', line: r.line });
          setRemoving(true);
        }
      })
      .catch(() => undefined);
  }, [renameOffer, removeOffer, ownKey]);
  const removeWaiting = Boolean(own && remove && (remove.state === 'waiting' || removeNote));
  const canRemove = Boolean(own && remove && !removeWaiting);
  const loading = !data || data.loading;
  const busy = data?.busy ?? null;
  // GitHub busy before the team's list was ever read here: a wait, never "Product not found".
  if (data && !data.loading && !product && busy) {
    return (
      <div className="pp" data-product-page={productKey}>
        <BusyNotice busy={busy} onRetry={onRetry} signedIn={signedIn} />
      </div>
    );
  }
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
  // A visitor on a product Bridge cannot read for them (a private repository): never "Nothing explored here yet" nor a
  // start action they cannot use, only what they can do about it (sign in).
  const closed = !loading && visitor && data?.reached === false && cards.length === 0;
  const empty = !loading && !data?.failed && !busy && !closed && cards.length === 0;
  // GitHub busy with nothing kept: the calm moment stands for the list.
  const busyAlone = Boolean(busy) && !loading && cards.length === 0;
  const library = Boolean(product?.default);
  const start = (appearance: 'menu' | 'button') => (
    <span className="cg-create" data-greet="">
      <StartExploration components={components} product={product?.key ?? productKey} appearance={appearance} />
    </span>
  );
  // A designer of the team on the library's page, with nothing yet: no start there, the page's lead says where asks go.
  const asks = empty && library && !lead;
  const choice = choiceCard;
  // More actions, at the end of the title's line: what this viewer may still do to the product (none: no menu).
  const menu =
    own && !head.editing ? (
      <ProductMenu name={name} rename={head.canRename} remove={canRemove} onRename={head.start} onRemove={() => setRemoving(true)} trigger={menuButton} />
    ) : null;
  const startAction = product && !empty && !closed ? start('menu') : null;
  const titleAfter =
    head.after || removeWaiting ? (
      <>
        {head.after}
        {removeWaiting && <Badge tone="neutral">{REMOVE_PRODUCT_WORDS.waiting}</Badge>}
      </>
    ) : null;
  return (
    <div className="pp" data-product-page={product?.key ?? productKey}>
      <StudioHead
        title={head.title}
        titleAfter={titleAfter}
        summary={loading && !cards.length ? '' : data?.failed || busyAlone ? '' : closed ? signedOutProductLine(name) : asks && product ? emptyProductLine(product, true, false) : productSummary(cards)}
        // One primary action: on the title's line, or in the empty moment when there is nothing yet.
        actions={startAction}
        // More actions acts on the product: last on the title's line, on a phone too.
        more={menu}
      >
        {/* A visitor is not told whether Bridge reaches the product: a developer fact they cannot act on. */}
        {product && data && <Facts product={product} data={closed ? { ...data, reached: null } : data} copy={copy ?? null} library={libraryUpdate} />}
        {product && copySetup && <CopySetupLine setup={copySetup} />}
        <p className="t-ui t-muted pp-rename-note" role="status">
          {[head.note, removeNote].filter(Boolean).join(' ')}
        </p>
      </StudioHead>
      {own && remove && (
        <RemoveProductDialog
          name={name}
          open={removing}
          onOpenChange={(o) => {
            setRemoving(o);
            if (!o) setRemoveResume(null);
          }}
          resume={removeResume}
          onSend={async () => {
            await remove.onSend();
            setRemoveNote(REMOVE_PRODUCT_WORDS.sent(name));
          }}
        />
      )}
      {data?.failed && <p className="t-body t-muted">{data.failed}</p>}
      {busy && !busyAlone && <BusyNotice busy={busy} onRetry={onRetry} signedIn={signedIn} kept />}
      {loading && !cards.length ? (
        <ul className="sh-cards" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="sh-card-item">
              <Skeleton variant="rect" className="pp-skel" />
            </li>
          ))}
        </ul>
      ) : busyAlone && busy ? (
        <BusyNotice busy={busy} onRetry={onRetry} signedIn={signedIn} />
      ) : empty ? (
        <section className="zone sh-zone pp-empty" aria-label={asks ? 'Ask for a library change' : `Nothing explored in ${name} yet`}>
          {product && asks ? (
            <ul className="sh-choices">
              {LIBRARY_ASKS.map((a) => (
                <li key={a.key}>
                  {choice(
                    a.drawing,
                    <Link href={studioHref(a.path)} className="sh-choice-btn" data-card-primary="">
                      <span className="sh-choice-title">{a.title}</span>
                    </Link>,
                    a.line,
                  )}
                </li>
              ))}
            </ul>
          ) : (
            product &&
            choice(
              'paint',
              <StartExploration components={components} product={product.key} appearance="choice" />,
              emptyProductLine(product, library, lead),
            )
          )}
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
      {/* The designers' copy is made, but only a tick on GitHub lets Bridge open it: an admin's one more step. */}
      {copySetup?.kind === 'access' && product && (
        <section className="fg-card pp-copy-access" aria-label={`Your designers' copy of ${name}`} data-copy-setup="access">
          <CopyAccessStep access={copySetup.access} onVisible={copySetup.onVisible} />
        </section>
      )}
      {/* The admin's one step before previews: after the way to start (or the list), never instead of it. */}
      {previews && product && !product.default && !loading && !closed && !busyAlone && !data?.failed && <ProductPreviewsStep name={name} step={previews} />}
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
export default function ProductPage({
  productKey,
  components = [],
  previews: builtPreviews = null,
}: {
  productKey?: string;
  components?: HomeComponent[];
  /** Self-hosted: the team's previews settings, read at build (a team shell reads its own once loaded). */
  previews?: PreviewsLike | null;
}) {
  const [key] = useState(() => productKey ?? (typeof location !== 'undefined' ? productKeyFromPath(location.pathname) : null) ?? '');
  const [data, setData] = useState<ProductPageData | null>(null);
  const [comps, setComps] = useState<HomeComponent[]>(components);
  /** An admin of the team's repository, in a real team (lib/product-name canRenameProduct): may rename a product its settings list. */
  const [canRename, setCanRename] = useState(false);
  /** An admin of a real team: may connect the product to a host (the previews step), with the library's code. */
  const [hosting, setHosting] = useState<{ library: string | null } | null>(null);
  /** The team's previews settings (bridge.config.json `previews`): the library's host, and products' own previews. */
  const [teamPreviews, setTeamPreviews] = useState<PreviewsLike | null>(builtPreviews);
  const [sent, setSent] = useState(false);
  const [removeSent, setRemoveSent] = useState(false);
  /** The keys the team's own bridge.config.json lists (not the defaults Bridge shows without a list). */
  const [listedKeys, setListedKeys] = useState<string[]>([]);
  /** Not an email member: may make the team's copy of the product (GitHub's fork needs a GitHub sign-in). */
  const [canMake, setCanMake] = useState(false);
  /**
   * May get the latest into the copy: anyone who can edit the team, an email member too (Bridge's server syncs the
   * copy for them, api/contribute merge-upstream). Without it, "changed since your copy" stays hidden.
   */
  const [canLatest, setCanLatest] = useState(false);
  const [reload, setReload] = useState(0);
  /** May change the library, as the start action reads it (StartExploration): a designer of the team may not. */
  const [lead, setLead] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  /** Nobody signed in at all (no GitHub sign-in, no email member): a visitor. */
  const [visitor, setVisitor] = useState(false);
  /** A real team (never the sample one): the library line reads the product's own repository. */
  const [realTeam, setRealTeam] = useState(false);
  /** A lead or an admin: may send the library update to the developers. */
  const [canSend, setCanSend] = useState(false);
  const [libView, setLibView] = useState<LibraryView | null>(null);
  const [withGitHub, setWithGitHub] = useState(false);
  /** An admin of the team: the only one who may tick a new copy on GitHub (the one more step). */
  const adminRef = useRef(false);
  /** The designers' copy this browser's Add a product asked for, being made in the background (lib/design-copy.ts). */
  const [copySetup, setCopySetup] = useState<CopySetup | null>(null);
  const setupStarted = useRef(false);
  /** Makes the copy with this viewer's sign-in, then the page reads it again; never a step for designers. */
  const runCopySetup = async (p: ProductConfig) => {
    const m = await import('../../../scripts/design-copy');
    const settle = (r: CopyOutcome) => {
      if (r === 'ready') {
        m.forgetCopySetup(p.key);
        setCopySetup(null);
        setReload((n) => n + 1);
        return;
      }
      setCopySetup({ kind: 'failed', line: setupLine(p.name, r), retry: () => void runCopySetup(p) });
    };
    setCopySetup({ kind: 'making' });
    const r = await m.makeCopy(p);
    if (!needsCopyAccess(r)) return settle(r);
    // Made, but only a tick on GitHub lets Bridge open it: an admin's step; anyone else reads who can.
    if (!adminRef.current) return setCopySetup({ kind: 'failed', line: setupLine(p.name, 'ask'), retry: () => void runCopySetup(p) });
    setCopySetup({
      kind: 'access',
      access: r,
      onVisible: async () => {
        setCopySetup({ kind: 'making' });
        settle(await m.finishCopy(p));
      },
    });
  };
  useEffect(() => {
    const p = data?.product;
    if (!p || !data || data.loading || !canMake || setupStarted.current) return;
    void import('../../../scripts/design-copy').then((m) => {
      if (setupStarted.current || !m.copySetupPending(p.key)) return;
      // The copy is already there (made by a teammate's first exploration): nothing to make.
      if (data.copy?.kind !== 'missing') {
        if (data.copy?.kind === 'ready') m.forgetCopySetup(p.key);
        return;
      }
      setupStarted.current = true;
      void runCopySetup(p);
    });
  }, [data, canMake]);
  useEffect(() => {
    const p = data?.product;
    // The library line is a lead's or an admin's (they send the update): nobody else reads the product's library.
    if (!realTeam || !canSend || !p || p.default) return;
    let live = true;
    void (async () => {
      const [{ readLibraryView }, { signedInWithGitHub }] = await Promise.all([import('../../../scripts/library-update'), import('../../../scripts/github-session')]);
      if (live) setWithGitHub(signedInWithGitHub());
      const v = await readLibraryView(p);
      if (live) setLibView(v);
    })();
    return () => {
      live = false;
    };
  }, [realTeam, canSend, data?.product?.key, reload]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ isSampleTeam }, { siteConfig }, { onAccess, designerRoute }, { libraryLead }] = await Promise.all([
        import('../../../lib/demo'),
        import('../../../scripts/repo-context'),
        import('../../../scripts/github-session'),
        import('../../../lib/create-branch'),
      ]);
      const c = siteConfig();
      if (isSampleTeam(c.owner && c.repo ? `${c.owner}/${c.repo}` : null)) return;
      setRealTeam(true);
      onAccess((a) => {
        if (!live) return;
        setCanLatest(a?.write === true);
        setLead(libraryLead(a) && !designerRoute());
        // Leads and admins (an email admin too) send the library update; the server checks again.
        setCanSend((libraryLead(a) && !designerRoute()) || Boolean(a?.admin));
      });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ isSampleTeam }, { onAccess }, { repoContext }, { canRenameProduct }] = await Promise.all([
        import('../../../lib/demo'),
        import('../../../scripts/github-session'),
        import('../../../scripts/repo-context'),
        import('../../../lib/product-name'),
      ]);
      // On a team shell and on the team's own Studio alike (the config pull request goes to the team's repository).
      onAccess((a) => {
        if (!live) return;
        const r = repoContext();
        const sample = isSampleTeam(`${r.owner}/${r.repo}`);
        setCanRename(canRenameProduct(a, sample));
        // The previews step is an admin's (connecting a host is theirs), on a real team only.
        setHosting(!sample && isTeamAdmin(a) ? { library: r.owner && r.repo ? `${r.owner}/${r.repo}` : null } : null);
        adminRef.current = isTeamAdmin(a);
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
      // GitHub busy for the team's read: the team as last kept here (team.busy), or nothing yet (the error's wait).
      let teamBusy: GitHubBusy | null = null;
      if (isHosted()) {
        // A team's products and components come from its own bridge.config.json and design system.
        const [{ loadTeamData, resetTeamData }, { githubBusy }] = await Promise.all([import('../../../scripts/team-data'), import('../../../lib/github-busy')]);
        // Try again after a wait reads the team again, not the copy kept from the busy read.
        if (reload > 0) resetTeamData();
        try {
          const team = await loadTeamData();
          teamBusy = team.busy ?? null;
          if (live) setTeamPreviews(team.model.config?.previews ?? null);
          if (live) setComps((team.model.components?.list ?? []).map((c) => ({ name: c.name, slug: c.slug, family: c.category })).sort((a, b) => a.name.localeCompare(b.name)));
        } catch (err) {
          // The products fall back to the defaults; the start flow still opens. GitHub busy: the page says so.
          teamBusy = githubBusy(err);
        }
      }
      const { siteConfig } = await import('../../../scripts/repo-context');
      if (live) setListedKeys(((siteConfig() as { products?: ProductConfig[] }).products ?? []).map((p) => p.key.toLowerCase()));
      const { loadProductPage } = await import('../../../scripts/product-page');
      const { currentContributor, currentViewer, sessionSettled } = await import('../../../scripts/github-session');
      // Who reads is known before the page paints what it read: a visitor never sees the member's empty moment first.
      await sessionSettled();
      if (live) {
        setSignedIn(Boolean(currentViewer()));
        setVisitor(!currentViewer() && !currentContributor());
      }
      await loadProductPage(key, (d) => live && setData(d), { teamBusy });
      if (live) {
        setSignedIn(Boolean(currentViewer()));
        setVisitor(!currentViewer() && !currentContributor());
      }
      // Making the copy forks on GitHub: never through an email member's session (getting the latest is, canLatest).
      if (live) setCanMake(!currentContributor());
    })();
    return () => {
      live = false;
    };
  }, [key, reload]);
  const copy: CopyActions | null =
    canLatest && data?.product && data.copy
      ? {
          latest: canLatest
            ? async () => {
                const session = await import('../../../scripts/github-session');
                if (!session.hasWorkingToken()) {
                  const { ghAction } = await import('../../../lib/gh-wording');
                  return `${ghAction('get the latest', session.prefersSignIn())}.`;
                }
                const { getLatest } = await import('../../../scripts/design-copy');
                // Kept if the person has to sign in again first: back on this page, it says to do it again.
                const keep = await import('../../../scripts/pending-action');
                keep.armPendingAction('retry', { label: 'get the latest' });
                const latest = await getLatest(data.product!);
                keep.disarmPendingAction();
                return latestLine(latest);
              }
            : null,
        }
      : null;
  useEffect(() => {
    // A team shell is built once for every product ("Product | Bridge Studio"): the tab names this one.
    if (data?.product) document.title = document.title.replace(/^[^|]*\|/, `${data.product.name} |`);
  }, [data?.product]);
  // Only a product the team's own settings list can be renamed (not the defaults Bridge shows without a list).
  // Never the library itself (the default product): it is neither renamed nor removed.
  const listed = Boolean(data?.product && !data.product.default && listedKeys.includes(data.product.key.toLowerCase()));
  const rename: ProductRename | null =
    canRename && listed && data?.product
      ? {
          state: sent ? 'waiting' : 'offer',
          onSend: async (to) => {
            const { proposeProductName } = await import('../../../scripts/roles');
            // Kept if the person has to sign in again first: the name opens again with it (scripts/pending-action).
            const kept = await import('../../../scripts/pending-action');
            kept.armPendingAction('rename-product', { key: data.product!.key, from: data.product!.name, to });
            await proposeProductName({ key: data.product!.key, from: data.product!.name, to });
            kept.disarmPendingAction();
            setSent(true);
          },
        }
      : null;
  // Remove from Bridge: the same people and the same path as the rename (the config pull request). Only the product's
  // entry leaves the Bridge settings; its own repository is never written, let alone deleted.
  const remove: ProductRemove | null =
    canRename && listed && data?.product
      ? {
          state: removeSent ? 'waiting' : 'offer',
          onSend: async () => {
            const { proposeProductRemoval } = await import('../../../scripts/roles');
            const p = data.product!;
            const kept = await import('../../../scripts/pending-action');
            kept.armPendingAction('remove-product', { key: p.key, name: p.name });
            await proposeProductRemoval({ key: p.key, name: p.name, ...(p.repo ? { repo: p.repo } : {}) });
            kept.disarmPendingAction();
            setRemoveSent(true);
          },
        }
      : null;
  const libLine = data?.product && libView ? libraryLine(data.product.name, libView.state, { update: libView.update, canSend, github: withGitHub }) : null;
  const library: LibraryUpdate | null = libLine
    ? {
        line: libLine,
        ...(libLine.send && data?.product
          ? {
              send: async () => {
                const { sendLibraryUpdate } = await import('../../../scripts/library-update');
                // Kept if the person has to sign in again first: back on this page, it says to do it again.
                const keep = await import('../../../scripts/pending-action');
                keep.armPendingAction('retry', { label: 'send the library update' });
                const r = await sendLibraryUpdate(data.product!);
                keep.disarmPendingAction();
                // Sent (or already there): the line says so at once, with the link for people with GitHub.
                if (r.pr) setLibView((v) => (v ? { ...v, update: { number: r.pr!.number, url: r.pr!.url, version: r.pr!.version } } : v));
              },
            }
          : {}),
      }
    : null;
  // Only once the product is read: the step names the host its team's other products already use.
  const previews =
    hosting && data?.product && !data.loading && showsPreviewsStep({ admin: true, sample: false, product: data.product, previews: teamPreviews })
      ? previewsStep(data.product, data.products, teamPreviews, hosting.library)
      : null;
  return (
    <ProductPageView
      productKey={key}
      data={data}
      components={comps}
      rename={rename}
      remove={remove}
      copy={copy}
      copySetup={copySetup}
      lead={lead}
      onRetry={() => setReload((n) => n + 1)}
      signedIn={signedIn}
      visitor={visitor}
      library={library}
      previews={previews}
    />
  );
}
