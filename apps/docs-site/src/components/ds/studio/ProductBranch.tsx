// A product branch (Branches > a branch started for a product, ?exploration=N), the validated ProdBranch mockup: the
// title with "Try it in the product", one sentence (built with the library, what was missing, who opened the library
// branches), then two regions on one line: the screen (the before and after the visual impact read, filled by
// scripts/product-branch.ts) and the Harbor zone "Missing from the library", one row per piece with its library branch,
// status and reviewer, and "Why it already shows in your screen" folded. "For developers" folds the branch, the library
// branches and the commands. Data: lib/product-branch.ts over the core records. Styles: styles/product-branch.css.
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChevronLeft, Ellipsis } from 'lucide-react';
import {
  Accordion,
  AccordionItem,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Breadcrumb,
  Button,
  Card,
  CardBody,
  Icon,
  IconButton,
  Link,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  TokenValue,
  Tooltip,
} from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import type { PieceActionKind, PieceRowView } from '../../../lib/product-branch';

export interface ProductBranchProps {
  number: number;
  crumbs: { label: string; href?: string }[];
  title: string;
  /** Lead, the strong part, the rest: "Built with the library. **1 piece was missing**, and Claude AI opened a library branch for it." */
  sentence: { lead: string; strong: string; rest: string };
  /** The product preview with the Bridge toolbar, as GitHub reported it; null while unknown. */
  tryUrl: string | null;
  /** Null while the library branches are read. */
  rows: PieceRowView[] | null;
  /** The pieces were checked at least once. */
  checked: boolean;
  why: { title: string; text: string } | null;
  /** "Your screen": the before and after of the visual impact, painted into #pb-visual by the script; none: one column. */
  visual: 'loading' | 'shown' | 'none';
  product: string;
  /** Actions need a working GitHub token; without one the row action asks to connect. */
  connected: boolean;
  connectLabel: (goal: string) => string;
  onAct: (row: PieceRowView, kind: PieceActionKind) => Promise<string | void>;
  /** Exploration actions: promote to review (the shared dialog), close without merging. Null when not offered. */
  onPromote: (() => void) | null;
  onClose: (() => Promise<string | void>) | null;
  developer: { label: string; value: string }[];
  githubUrl: string;
  ask: string;
  said?: string;
}

function PieceRow({ row, p, busy, run }: { row: PieceRowView; p: ProductBranchProps; busy: string | null; run: (row: PieceRowView, kind: PieceActionKind) => void }) {
  const href = row.library?.href ?? null;
  const a = row.action;
  return (
    <li className="pb-row-item">
      <Card interactive={Boolean(href)} padding="compact" className="pb-row">
        <CardBody className="pb-row-body">
          {row.value && <TokenValue value={row.value} size="sm" className="pb-row-value" aria-hidden="true" />}
          <span className="pb-row-text">
            {href ? (
              <Link href={href} variant="subtle" className="pb-row-title" data-card-primary {...{ [`data-open-${row.library!.opens}`]: row.library!.number }}>
                <span className="pb-strong">{row.title}</span>
              </Link>
            ) : (
              <span className="pb-row-title pb-strong">{row.title}</span>
            )}
            <span className="pb-row-line">
              {row.library ? (
                <Badge tone={row.library.tone} size="md">
                  {row.library.line}
                </Badge>
              ) : (
                <span className="pb-muted">No library branch yet</span>
              )}
            </span>
          </span>
          {a &&
            (p.connected ? (
              <Button variant="secondary" size="md" className="pb-row-act" loading={busy === `${row.id}:${a.kind}`} onClick={() => run(row, a.kind)}>
                {a.label}
              </Button>
            ) : (
              <Button variant="secondary" size="md" className="pb-row-act" data-gh-open="">
                {p.connectLabel(a.label.charAt(0).toLowerCase() + a.label.slice(1))}
              </Button>
            ))}
        </CardBody>
      </Card>
    </li>
  );
}

export function ProductBranch(p: ProductBranchProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState(p.said ?? '');
  const [confirm, setConfirm] = useState(false);
  const run = (row: PieceRowView, kind: PieceActionKind) => {
    setBusy(`${row.id}:${kind}`);
    setSaid('');
    p.onAct(row, kind)
      .then((r) => setSaid(r ?? ''))
      .catch((err: Error) => setSaid(err.message))
      .finally(() => setBusy(null));
  };
  const close = () => {
    setConfirm(false);
    setSaid('');
    p.onClose?.()
      .then((r) => setSaid(r ?? ''))
      .catch((err: Error) => setSaid(err.message));
  };
  const twoRegions = p.visual !== 'none';
  return (
    <div className="pb">
      <Breadcrumb items={p.crumbs} className="pb-crumbs" />
      <Link variant="subtle" href={p.crumbs[0]!.href ?? '/studio/changes/'} className="pb-crumbs-phone" data-back="">
        <Icon icon={ChevronLeft} size="sm" /> {p.crumbs[0]!.label}
      </Link>
      <header className="pb-head">
        <h1 className="pb-title" tabIndex={-1}>
          {p.title}
        </h1>
        <div className="pb-head-acts">
          {p.tryUrl ? (
            <ButtonLink variant="primary" size="lg" href={p.tryUrl} target="_blank" rel="noopener">
              Try it in the product
            </ButtonLink>
          ) : (
            <Tooltip content="The preview appears a few minutes after each update to the branch.">
              <Button variant="primary" size="lg" disabled>
                Try it in the product
              </Button>
            </Tooltip>
          )}
          {(p.onPromote || p.onClose) && (
            <Menu>
              <Tooltip content="More actions">
                <MenuTrigger render={<IconButton icon={Ellipsis} label="More actions" variant="secondary" size="lg" />} />
              </Tooltip>
              <MenuContent align="end">
                {p.onPromote && <MenuItem onClick={p.onPromote}>Send for review</MenuItem>}
                {p.onPromote && p.onClose && <MenuSeparator />}
                {p.onClose && (
                  <MenuItem tone="danger" onClick={() => setConfirm(true)}>
                    Close without merging
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
      </header>
      <p className="pb-lead">
        {p.sentence.lead}
        {p.sentence.strong && <strong>{p.sentence.strong}</strong>}
        {p.sentence.rest}
      </p>
      <div className={twoRegions ? 'pb-grid' : 'pb-grid is-one'}>
        {twoRegions && (
          <section className="pb-screen" aria-label={`Your screen in ${p.product}`}>
            {p.visual === 'loading' && <Skeleton variant="rect" className="pb-skel" />}
            <div id="pb-visual" aria-live="polite" />
          </section>
        )}
        <section className="pb-missing zone" aria-labelledby="pb-missing-h">
          <h2 className="pb-h2" id="pb-missing-h">
            Missing from the library
          </h2>
          {!p.checked ? (
            <p className="pb-muted">Not checked yet. {p.ask}</p>
          ) : p.rows === null ? (
            <Skeleton variant="rect" className="pb-skel-row" />
          ) : p.rows.length === 0 ? (
            <p>Nothing: every value and component comes from the library.</p>
          ) : (
            <ul className="pb-rows">
              {p.rows.map((row) => (
                <PieceRow key={row.id} row={row} p={p} busy={busy} run={run} />
              ))}
            </ul>
          )}
          {p.why && (
            <Accordion appearance="flush" headingLevel={3} className="pb-why">
              <AccordionItem value="why" title={p.why.title}>
                <p>{p.why.text}</p>
              </AccordionItem>
            </Accordion>
          )}
        </section>
      </div>
      <p className="pb-said" role="status" aria-live="polite">
        {said}
      </p>
      <Accordion className="pb-dev" headingLevel={2}>
        <AccordionItem value="dev" title="For developers">
          <dl className="pb-dev-list">
            {p.developer.map((d) => (
              <div key={d.label} className="pb-dev-row">
                <dt>{d.label}</dt>
                <dd className="pb-mono">{d.value}</dd>
              </div>
            ))}
          </dl>
          <Link href={p.githubUrl} target="_blank" rel="noopener">
            Open on GitHub
          </Link>
        </AccordionItem>
      </Accordion>
      <AlertDialog open={confirm} onOpenChange={(o) => !o && setConfirm(false)}>
        <AlertDialogContent title="Close this branch without merging?" description="Its previews stay for reference. Library branches opened for it stay open." confirmLabel="Close branch" tone="danger" onConfirm={close} />
      </AlertDialog>
    </div>
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Renders the page into `el` (synchronously the first time, so the script can fill #pb-visual). */
export function paintProductBranch(el: HTMLElement, props: ProductBranchProps) {
  // Another view painted over it (the branch review, an exploration): start a new root there.
  if (host === el && !el.querySelector(':scope > .pb')) {
    root = null;
    host = null;
  }
  if (host !== el || !root) {
    root?.unmount();
    el.replaceChildren();
    root = createRoot(el);
    host = el;
    flushSync(() => root!.render(<ProductBranch {...props} />));
    return;
  }
  root.render(<ProductBranch {...props} />);
}

export function unmountProductBranch() {
  root?.unmount();
  root = null;
  host = null;
}
