// The persistent banner while Studio shows the library as a change (lib/view-scope): one DS Banner, the mode the page
// is in, that says what the page shows and that nothing is saved. The way out sits on the same line (back to the
// main) with at most one more action: "Edit tokens in this branch" on Tokens, else "Open the branch". When
// both apply, "Open the branch" moves to the detail line as a link. When the change cannot be read, a warning Alert
// says why instead: an error is a message about the page, not a mode. Mounted by scripts/view-change.ts into the slot
// under the page title ([data-view-banner] on Tokens, Components and Quality).
import { createRoot, type Root } from 'react-dom/client';
import { Eye, TriangleAlert } from 'lucide-react';
import { Alert, Banner, Link } from '@bridge-ds/react';
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
  const back = (
    <ButtonLink variant="secondary" href={latestHref}>
      Back to main
    </ButtonLink>
  );
  if (error) {
    return (
      <Alert
        className="view-banner-bar"
        tone="warning"
        icon={TriangleAlert}
        announce="off"
        title={title}
        actions={
          <>
            {back}
            {changeHref && (
              <ButtonLink variant="ghost" href={changeHref}>
                Open the branch
              </ButtonLink>
            )}
          </>
        }
      >
        {body}
      </Alert>
    );
  }
  // One more action besides the way out: editing wins on Tokens, the change page then goes to the detail line.
  const openInDetail = editHref && changeHref ? changeHref : null;
  const more = editHref ? (
    <ButtonLink variant="secondary" href={editHref}>
      Edit tokens in this branch
    </ButtonLink>
  ) : changeHref ? (
    <ButtonLink variant="secondary" href={changeHref}>
      Open the branch
    </ButtonLink>
  ) : null;
  return (
    <Banner
      className="view-banner-bar"
      title={title}
      icon={Eye}
      appearance="strong"
      sticky="below-header"
      actions={
        <>
          {more}
          {back}
        </>
      }
    >
      {body || openInDetail ? (
        <>
          {body}
          {body && openInDetail ? ' ' : null}
          {openInDetail && (
            <Link variant="subtle" href={openInDetail}>
              Open the branch
            </Link>
          )}
        </>
      ) : null}
    </Banner>
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
