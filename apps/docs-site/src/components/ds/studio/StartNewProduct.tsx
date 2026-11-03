// "It's a new product", the second choice card of Add a product: the team has no code for the product yet (a new
// product, or code not on GitHub). One small form (its name, its address on GitHub, where it
// lives when Bridge reaches more than one account), then Bridge starts its code from the product starter with the
// viewer's own GitHub sign-in (scripts/new-product.ts) and proposes it for review like Add product
// (scripts/roles.ts proposeNewProduct, designers' copy on). Last step: the way to its previews, Vercel or Cloudflare
// in a new window, Bridge never handles a password there. Words and rules: lib/new-product.ts. Rendered inside Add
// a product's dialog (AddProduct.tsx), which owns opening, closing and the busy lock.
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, ButtonGroup, Checkbox, DialogContent, Input, Select, Spinner, VisuallyHidden } from '@bridge-ds/react';
import type { ProductConfig } from '@bridge-ds/core';
import ButtonLink from '../ButtonLink';
import { Drawing } from './Drawing';
import { useCopy } from './TeamLink';
import { ADD_PRODUCT_WORDS as A, newProductEntry, productKeyFor, type ProductRepoChoice } from '../../../lib/add-product';
import { cleanProductName } from '../../../lib/product-name';
import {
  CLOUDFLARE_IMPORT_URL,
  NEW_PRODUCT_WORDS as W,
  addressLine,
  newProductProblem,
  ownersFrom,
  refusalLine,
  slugFor,
  startRefusal,
  vercelImportUrl,
} from '../../../lib/new-product';
import '../../../styles/add-product.css';

export interface StartNewProductProps {
  products: ProductConfig[];
  /** The GitHub account the team works in (Add a product's installation account), first in Where. */
  account: string | null;
  /** The products Bridge can see: their accounts are the other places the product can live. */
  repos: readonly ProductRepoChoice[];
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** Back to Add a product's choice. */
  onBack: () => void;
  /** The product is started and proposed: the dialog counts it as sent when it closes. */
  onProposed: () => void;
  /** Started on GitHub but the review could not be opened: back to the list with it picked and the reason. */
  onStartedOnly: (repo: ProductRepoChoice, name: string) => void;
  /** Done: close the dialog. */
  onDone: () => void;
}

type Phase = { kind: 'form' } | { kind: 'ready'; name: string; full: string };

export default function StartNewProduct({ products, account, repos, busy, setBusy, onBack, onProposed, onStartedOnly, onDone }: StartNewProductProps) {
  // The accounts it can live in: the team's account, the ones Bridge reads products in, and the team's products' own
  // accounts. Read on every render: the list often arrives after the form opens, and the first one is the default.
  const owners = ownersFrom(account, [...repos, ...products.flatMap((p) => (p.repo ? [{ full: p.repo }] : []))]);
  const [picked, setOwner] = useState<string | null>(null);
  const owner = picked && owners.includes(picked) ? picked : (owners[0] ?? null);
  const [name, setName] = useState('');
  const [copyOn, setCopyOn] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [error, setError] = useState<{ line: string; ask?: { label: string; message: string } } | null>(null);
  const { copied, said, copy } = useCopy(3000);
  const formId = 'addp-new-form';
  const slug = slugFor(cleanProductName(name));
  // Chosen from the cards: the name takes the focus (the card that opened this step is gone).
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = newProductProblem({ name, owner }, products);
    if (problem) return setError({ line: problem });
    const clean = cleanProductName(name);
    setBusy(true);
    setError(null);
    let started: ProductRepoChoice;
    try {
      const m = await import('../../../scripts/new-product');
      started = await m.startProductCode({ owner: owner!, slug, name: clean });
    } catch (err) {
      setBusy(false);
      return setError(refusalLine(startRefusal(err as { status?: number; message?: string; detail?: string }), { owner: owner!, slug, name: clean }));
    }
    const key = productKeyFor(started.name, products.map((p) => p.key));
    try {
      const m = await import('../../../scripts/new-product');
      await m.linkProductCode(started, key);
      const entry = newProductEntry({ key, name: clean, repo: started.full, copy: copyOn, previews: null });
      const { proposeNewProduct } = await import('../../../scripts/roles');
      await proposeNewProduct(entry);
      onProposed();
      setPhase({ kind: 'ready', name: clean, full: started.full });
    } catch {
      onStartedOnly(started, clean);
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind === 'ready') {
    return (
      <DialogContent
        title={W.readyTitle}
        description={W.ready(phase.name)}
        hideClose
        footer={
          <ButtonGroup align="end">
            <Button variant="primary" onClick={onDone}>
              {W.done}
            </Button>
          </ButtonGroup>
        }
      >
        <div className="addp-wait">
          <Drawing name="foundations" width={96} className="addp-wait-art" />
          <div className="addp-wait-text">
            <p className="addp-wait-line" role="status">
              {W.previewsLead}
            </p>
            <ButtonGroup>
              <ButtonLink href={vercelImportUrl(phase.full)} target="_blank" rel="noopener noreferrer" iconEnd={ExternalLink}>
                {W.vercel}
              </ButtonLink>
              <ButtonLink href={CLOUDFLARE_IMPORT_URL} target="_blank" rel="noopener noreferrer" iconEnd={ExternalLink}>
                {W.cloudflare}
              </ButtonLink>
            </ButtonGroup>
            <p className="addp-more">{W.previewsLater}</p>
          </div>
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent
      title={W.title}
      description={W.lead}
      hideClose
      footer={
        <ButtonGroup align="end">
          <Button variant="secondary" disabled={busy} onClick={onBack}>
            {W.back}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={busy}>
            {W.create}
          </Button>
        </ButtonGroup>
      }
    >
      <form id={formId} onSubmit={(e) => void create(e)} noValidate className="addp-form">
        <Input
          ref={nameRef}
          label={W.name}
          hint={owner ? addressLine(owner, slug) : W.nameHelp}
          value={name}
          onValueChange={(v) => {
            setName(v);
            setError(null);
          }}
          autoComplete="off"
          disabled={busy}
        />
        {owners.length > 1 && (
          <Select
            label={W.where}
            hint={W.whereHelp}
            options={owners.map((o) => ({ value: o, label: o }))}
            value={owner}
            onValueChange={(v) => {
              setOwner(v);
              setError(null);
            }}
            disabled={busy}
          />
        )}
        <Checkbox label={A.copy} description={A.copyHelp} checked={copyOn} onCheckedChange={setCopyOn} disabled={busy} />
        <div role="status" aria-live="polite" className="addp-status">
          {busy && (
            <>
              <Spinner size="xs" /> {W.creating(cleanProductName(name))}
            </>
          )}
        </div>
        {error && (
          <div className="addp-pick">
            <p className="addp-error" role="alert">
              {error.line}
            </p>
            {error.ask && (
              <p className="addp-more">
                <Button variant="link" size="sm" iconStart={copied ? Check : Copy} onClick={() => void copy(error.ask!.message, 'Message copied. Paste it to an owner.')}>
                  {copied ? 'Message copied' : error.ask.label}
                </Button>
                <VisuallyHidden role="status">{said}</VisuallyHidden>
              </p>
            )}
          </div>
        )}
      </form>
    </DialogContent>
  );
}
