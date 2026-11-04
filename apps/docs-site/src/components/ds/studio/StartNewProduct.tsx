// A new product, inside Add a product (AddProduct.tsx, validated board "Add a product v3"), after the first question:
//   - B, "It's a new product": its name (no place to pick: it goes where the team's products live, lib/new-product.ts
//     newProductOwner) and the designers' copy choice, then Create product.
//   - D2, "Only its address" (`kind: 'address'`): its name and its address (an https link or a bare domain, kept as its
//     https origin, core productAddressOf), the copy choice, then Add product. The team cannot reach that product's
//     code, so Bridge starts the design team's own code for it the same way and keeps the address in the entry.
// Both start the code from the product starter with the viewer's own GitHub sign-in (scripts/new-product.ts), link it
// to the library, then hand the entry to the dialog (`onAdd`), which adds it to the team and opens its page. Back
// returns to the first question. Words and rules: lib/new-product.ts. The dialog owns opening, closing and the busy lock.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, ButtonGroup, Checkbox, DialogContent, Input, Spinner, VisuallyHidden } from '@bridge-ds/react';
import { productAddressOf, type ProductConfig } from '@bridge-ds/core';
import { useCopy } from './TeamLink';
import { ADD_PRODUCT_WORDS as A, newProductEntry, productKeyFor, type ProductRepoChoice } from '../../../lib/add-product';
import { cleanProductName } from '../../../lib/product-name';
import { ADDRESS_PRODUCT_WORDS as D, NEW_PRODUCT_WORDS as W, addressProblem, isNameProblem, newProductOwner, newProductProblem, refusalLine, slugFor, startRefusal } from '../../../lib/new-product';
import type { PendingValues } from '../../../lib/pending-action';
import '../../../styles/add-product.css';

export interface StartNewProductProps {
  products: ProductConfig[];
  /** The team's library ("owner/repo"): its owner is where a team with no product yet starts one. */
  library: string | null;
  /** The GitHub account the team works in (Add a product's installation account), when the library is not known. */
  account: string | null;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** "Give designers their own copy", shared with the list of found products. */
  copy: boolean;
  onCopyChange: (on: boolean) => void;
  /** Under the form: the way to code already on GitHub, and what Bridge knows about it (the dialog's). */
  aside?: ReactNode;
  /** Started on GitHub and linked: the dialog adds it to the team (and opens its page, or says why not). */
  onAdd: (entry: ProductConfig, started: ProductRepoChoice) => Promise<void>;
  /** Back from GitHub (a sign-in): what was typed, and the line over the form. Create waits for a click. */
  resume?: { values: PendingValues; line: string } | null;
  /** `address`: D2, "Only its address" (the address field, Add product). Default: B, a new product. */
  kind?: 'new' | 'address';
  /** Back to Add a product's first question. */
  onBack: () => void;
}

export default function StartNewProduct({ products, library, account, busy, setBusy, copy: copyOn, onCopyChange, aside, onAdd, resume = null, kind = 'new', onBack }: StartNewProductProps) {
  const kept = resume?.values ?? null;
  const fromAddress = kind === 'address';
  const [address, setAddress] = useState(typeof kept?.address === 'string' ? kept.address : '');
  const [addressError, setAddressError] = useState<string | null>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  // Where it goes, no choice to make (lib/new-product.ts newProductOwner): where the team's products already live, else
  // the team's own account. Read on every render: the account often arrives after the form opens.
  const owner = newProductOwner(products, library, account);
  const [name, setName] = useState(typeof kept?.name === 'string' ? kept.name : '');
  // "Back from GitHub. Create Atlas now?" until the person changes something or creates.
  const [note, setNote] = useState<string | null>(resume?.line ?? null);
  const [error, setError] = useState<{ line: string; ask?: { label: string; message: string } } | null>(null);
  // What is wrong with the name, on the name field (set when Create product is clicked, cleared as the person types).
  const [nameError, setNameError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { copied, said, copy } = useCopy(3000);
  const formId = 'addp-new-form';
  const slug = slugFor(cleanProductName(name));
  const nameRef = useRef<HTMLInputElement>(null);
  // Back from GitHub: Create product takes the focus (the name is already there).
  const createRef = useRef<HTMLButtonElement>(null);
  useEffect(() => (resume ? createRef.current : nameRef.current)?.focus(), []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = newProductProblem({ name, owner }, products);
    // The address, kept as its https origin: said on its own field when Bridge cannot read it.
    const live = fromAddress ? productAddressOf(address) : null;
    const badAddress = fromAddress ? addressProblem(address, live) : null;
    // A problem with the name is said on the name field, which takes the focus (Create product stays enabled and says
    // what is missing, as the DS Button guidance asks). Anything else: under the form.
    if (problem && isNameProblem(problem)) {
      setNameError(problem);
      setAddressError(badAddress);
      nameRef.current?.focus();
      return;
    }
    if (badAddress) {
      setAddressError(badAddress);
      addressRef.current?.focus();
      return;
    }
    if (problem) return setError({ line: problem });
    const clean = cleanProductName(name);
    setBusy(true);
    setError(null);
    setNote(null);
    // Kept if the person has to sign in again first: this form reopens with the same values (scripts/pending-action).
    const pending = await import('../../../scripts/pending-action');
    pending.armPendingAction('new-product', { name: clean, owner, copy: copyOn, ...(live ? { address: live } : {}) });
    let started: ProductRepoChoice;
    try {
      const m = await import('../../../scripts/new-product');
      started = await m.startProductCode({ owner: owner!, slug, name: clean });
    } catch (err) {
      setBusy(false);
      // The sign-in expired: its sentence (signing in fixes it), never "Ask an owner".
      const signIn = (await import('../../../scripts/resume')).signInLineFor(err, 'create products');
      if (signIn) return setError({ line: signIn });
      return setError(refusalLine(startRefusal(err as { status?: number; message?: string; detail?: string }), { owner: owner!, slug, name: clean }));
    }
    const key = productKeyFor(started.name, products.map((p) => p.key));
    // Its code is on GitHub now: if adding it still needs a sign-in, coming back offers to add it, not create it again.
    pending.armPendingAction('add-product', { repo: started.full, branch: started.defaultBranch, name: clean, copy: copyOn, ...(live ? { address: live } : {}) });
    setAdding(true);
    try {
      const m = await import('../../../scripts/new-product');
      await m.linkProductCode(started, key);
      await onAdd(newProductEntry({ key, name: clean, repo: started.full, copy: copyOn, previews: null, address: live }), started);
    } finally {
      setAdding(false);
      setBusy(false);
    }
  };

  const clean = cleanProductName(name);
  return (
    <DialogContent
      title={fromAddress ? D.title : W.title}
      description={fromAddress ? D.lead : W.lead}
      hideClose
      initialFocus={resume ? createRef : nameRef}
      footer={
        <ButtonGroup align="end">
          <Button variant="secondary" disabled={busy} onClick={onBack}>
            {A.back}
          </Button>
          <Button ref={createRef} type="submit" form={formId} variant="primary" loading={busy} disabled={busy}>
            {fromAddress ? D.add : W.create}
          </Button>
        </ButtonGroup>
      }
    >
      <form id={formId} onSubmit={(e) => void create(e)} noValidate className="addp-form">
        <Input
          ref={nameRef}
          label={W.name}
          hint={W.nameHelp}
          value={name}
          error={nameError ?? undefined}
          onValueChange={(v) => {
            setName(v);
            setNameError(null);
            setError(null);
            setNote(null);
          }}
          autoComplete="off"
          disabled={busy}
        />
        {fromAddress && (
          <Input
            ref={addressRef}
            label={D.address}
            hint={D.addressHelp}
            placeholder={D.addressPlaceholder}
            type="url"
            inputMode="url"
            value={address}
            error={addressError ?? undefined}
            onValueChange={(v) => {
              setAddress(v);
              setAddressError(null);
              setError(null);
              setNote(null);
            }}
            autoComplete="url"
            spellCheck={false}
            disabled={busy}
          />
        )}
        <Checkbox label={A.copy} description={A.copyHelp} checked={copyOn} onCheckedChange={onCopyChange} disabled={busy} />
        <div role="status" aria-live="polite" className="addp-status">
          {busy ? (
            <>
              <Spinner size="xs" /> {adding ? A.adding(clean) : fromAddress ? D.creating(clean) : W.creating(clean)}
            </>
          ) : (
            note
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
        {!busy && aside}
      </form>
    </DialogContent>
  );
}
