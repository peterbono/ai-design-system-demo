// The persistent banner while Studio shows the library as a change (lib/view-scope): one DS Alert that says what the
// page shows and that nothing is saved, with the ways out on the same line: back to the latest library, open the
// change, and on Tokens "Edit tokens in this change". Mounted by scripts/view-change.ts into the slot under the page
// title ([data-view-banner] on Tokens, Components and Quality).
import { createRoot, type Root } from 'react-dom/client';
import { Eye, TriangleAlert } from 'lucide-react';
import { Alert } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';

export interface ViewBannerProps {
  title: string;
  body: string;
  latestHref: string;
  /** The change page; left out where the page's own primary goes there (Quality). */
  changeHref?: string | null;
  /** Studio Tokens on a token change: switches the view to editing. */
  editHref?: string | null;
  error?: boolean;
}

export function ViewBanner({ title, body, latestHref, changeHref, editHref, error }: ViewBannerProps) {
  return (
    <Alert
      tone={error ? 'warning' : 'neutral'}
      icon={error ? TriangleAlert : Eye}
      announce="off"
      title={title}
      actions={
        <>
          {editHref && (
            <ButtonLink variant="primary" href={editHref}>
              Edit tokens in this change
            </ButtonLink>
          )}
          <ButtonLink variant="secondary" href={latestHref}>
            Back to latest library
          </ButtonLink>
          {changeHref && (
            <ButtonLink variant="ghost" href={changeHref}>
              Open the change
            </ButtonLink>
          )}
        </>
      }
    >
      {body}
    </Alert>
  );
}

const roots = new WeakMap<HTMLElement, Root>();

export function mountViewBanner(el: HTMLElement, props: ViewBannerProps) {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  root.render(<ViewBanner {...props} />);
}
