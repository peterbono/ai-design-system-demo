// "Why it exists" on the review of a library branch a product branch needs (the validated ProdReview mockup): who needs
// it, for which product branch and product, the way to the product preview, and, when the library already has a close
// value, the reviewer's question with "Suggest <nearest>" on the same line (a request for changes that says to use it).
// The one Harbor zone of the review. Data: lib/product-branch.ts productContextOf. Styles: styles/branch-review.css (br-why).
import { useState } from 'react';
import { Button, Link } from '@bridge-ds/react';
import type { ProductContextView } from '../../../lib/product-branch';

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
        <Link href={c.productHref} data-open-exploration={c.neededBy.pr}>
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
