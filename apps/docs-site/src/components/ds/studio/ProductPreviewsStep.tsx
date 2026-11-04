// "One step before the first preview", on a product page (ProductPage.tsx) under the way to start: for an admin only,
// while the product has no previews in the team's settings (lib/product-previews.ts showsPreviewsStep). A Field
// Guide drawing, one line naming the host the team already uses, "Connect on <host>" (its own page, a new tab: Bridge
// never sees the account) and "Use <other> instead" for a team that prefers the other one. One quiet note says who
// sees it and that Bridge does the rest. Once the previews exist the step is gone. Words: lib/new-product.ts.
import { ExternalLink } from 'lucide-react';
import { Link, VisuallyHidden } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { Drawing } from './Drawing';
import { PREVIEWS_STEP_WORDS as W } from '../../../lib/new-product';
import { HOST_NAMES, otherHost, type PreviewsStep } from '../../../lib/product-previews';

export function ProductPreviewsStep({ name, step }: { name: string; step: PreviewsStep }) {
  const host = HOST_NAMES[step.host];
  const other = HOST_NAMES[otherHost(step.host)];
  return (
    <section className="fg-card pp-previews" aria-labelledby="pp-previews-title" data-previews-step={step.host}>
      <Drawing name="foundations" width={96} className="pp-previews-art" />
      <div className="pp-previews-text">
        <div className="pp-previews-say">
          <h2 id="pp-previews-title" className="pp-previews-title">
            {W.title}
          </h2>
          <p className="t-ui t-muted">{W.line({ name, host, source: step.source })}</p>
        </div>
        <div className="pp-previews-actions">
          <ButtonLink href={step.connect} variant="primary" iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer" data-previews-connect="">
            {W.connect(host)}
            <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
          </ButtonLink>
          <Link href={step.other} variant="standalone" target="_blank" rel="noopener noreferrer" className="pp-previews-other">
            {W.other(other)}
            <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
          </Link>
        </div>
        <p className="t-ui t-muted pp-previews-note">{W.note}</p>
      </div>
    </section>
  );
}
