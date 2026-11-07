// Where a change comes from, at the top of its review (OriginLine), and "Why it exists" (the validated ProdReview
// mockup) when the library already has a close value: who needs it, the way to the product preview, and the reviewer's
// question with "Suggest <nearest>" on the same line (a request for changes that says to use it). The one Harbor zone of the review. Data: lib/product-branch.ts productContextOf. Styles: styles/branch-review.css (br-why).
import { useState } from 'react';
import { Button, Link } from '@bridge-ds/react';
import type { ChangeOrigin, ProductContextView } from '../../../lib/product-branch';

/**
 * Where a change comes from, at the top of its review: "From the exploration Profile page, Account app", the name opens
 * it. Only when Bridge knows it (lib/product-branch changeOrigin): no origin, no line.
 */
export function OriginLine({ origin: o, className }: { origin: ChangeOrigin; className?: string }) {
  return (
    <p className={className}>
      {o.exploration ? 'From the exploration ' : 'From '}
      <Link href={o.href} data-open-exploration={o.number} {...(o.productKey ? { 'data-product': o.productKey } : {})}>
        {o.name}
      </Link>
      , {o.product}
    </p>
  );
}

export interface ProductContextProps {
  context: ProductContextView & { previewUrl: string | null };
  /** The viewer may request changes on this branch: "Suggest <nearest>" shows. */
  canSuggest: boolean;
  onSuggest: (comment: string) => Promise<string | void>;
}

export function ProductContext({ context: c, canSuggest, onSuggest }: ProductContextProps) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const suggest = () => {
    if (!c.suggest) return;
    setBusy(true);
    setSaid('');
    onSuggest(c.suggest.comment)
      .then((r) => setSaid(r ?? ''))
      .catch((err: Error) => setSaid(err.message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="br-why zone" aria-labelledby="br-why-h">
      <h2 className="br-why-h" id="br-why-h">
        Why it exists
      </h2>
      <p className="br-why-line">
        {c.who} needs it for <strong>{c.title}</strong> in {c.product}.
      </p>
      {c.previewUrl ? (
        <Link href={c.previewUrl} target="_blank" rel="noopener">
          Open the product preview
        </Link>
      ) : (
        <Link href={c.productHref} data-open-exploration={c.neededBy.pr} {...(c.neededBy.repo ? { 'data-product': c.neededBy.product } : {})}>
          Open the product branch
        </Link>
      )}
      {c.question && (
        <div className="br-why-ask">
          <p className="br-muted">{c.question}</p>
          {canSuggest && c.suggest && (
            <Button variant="secondary" size="lg" loading={busy} onClick={suggest}>
              {c.suggest.label}
            </Button>
          )}
        </div>
      )}
      {said && (
        <p className="br-muted" role="status">
          {said}
        </p>
      )}
    </section>
  );
}
