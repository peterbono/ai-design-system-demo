// A new product, inside Add a product (AddProduct.tsx, validated board "Add a product v3", B): the dialog opens here
// when Bridge found nothing on GitHub, or from "Start a new product". One small form (its name; no place to pick: it
// goes where the team's products live, lib/new-product.ts newProductOwner), the designers' copy choice, and the way back
// to code already on GitHub (`aside`, given by the dialog). Create product starts its code from the product starter
// with the viewer's own GitHub sign-in (scripts/new-product.ts), links it to the library, then hands the entry to the
// dialog (`onAdd`), which adds it to the team and opens its page. Words and rules: lib/new-product.ts. The dialog owns
// opening, closing and the busy lock.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, ButtonGroup, Checkbox, DialogClose, DialogContent, Input, Spinner, VisuallyHidden } from '@bridge-ds/react';
import type { ProductConfig } from '@bridge-ds/core';
import { useCopy } from './TeamLink';
import { ADD_PRODUCT_WORDS as A, newProductEntry, productKeyFor, type ProductRepoChoice } from '../../../lib/add-product';
import { cleanProductName } from '../../../lib/product-name';
import { NEW_PRODUCT_WORDS as W, isNameProblem, newProductOwner, newProductProblem, refusalLine, slugFor, startRefusal } from '../../../lib/new-product';
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
}

export default function StartNewProduct({ products, library, account, busy, setBusy, copy: copyOn, onCopyChange, aside, onAdd, resume = null }: StartNewProductProps) {
  const kept = resume?.values ?? null;
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
    // A problem with the name is said on the name field, which takes the focus (Create product stays enabled and says
    // what is missing, as the DS Button guidance asks). Anything else: under the form.
    if (problem && isNameProblem(problem)) {
      setNameError(problem);
      nameRef.current?.focus();
      return;
    }
    if (problem) return setError({ line: problem });
    const clean = cleanProductName(name);
    setBusy(true);
    setError(null);
    setNote(null);
    // Kept if the person has to sign in again first: this form reopens with the same values (scripts/pending-action).
    const pending = await import('../../../scripts/pending-action');
    pending.armPendingAction('new-product', { name: clean, owner, copy: copyOn });
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
    pending.armPendingAction('add-product', { repo: started.full, branch: started.defaultBranch, name: clean, copy: copyOn });
    setAdding(true);
    try {
      const m = await import('../../../scripts/new-product');
      await m.linkProductCode(started, key);
      await onAdd(newProductEntry({ key, name: clean, repo: started.full, copy: copyOn, previews: null }), started);
    } finally {
      setAdding(false);
      setBusy(false);
    }
  };

  const clean = cleanProductName(name);
  return (
    <DialogContent
      title={W.title}
      description={W.lead}
      hideClose
      initialFocus={resume ? createRef : nameRef}
      footer={
        <ButtonGroup align="end">
          <DialogClose render={<Button variant="secondary" disabled={busy} />}>{A.cancel}</DialogClose>
          <Button ref={createRef} type="submit" form={formId} variant="primary" loading={busy} disabled={busy}>
            {W.create}
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
        <Checkbox label={A.copy} description={A.copyHelp} checked={copyOn} onCheckedChange={onCopyChange} disabled={busy} />
        <div role="status" aria-live="polite" className="addp-status">
          {busy ? (
            <>
              <Spinner size="xs" /> {adding ? A.adding(clean) : W.creating(clean)}
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
