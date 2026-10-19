// Continue a change, the DS parts: where the edits go (a RadioGroup in the send dialog, like the Figma plugin's "Add
// to open pull request"), the banner of the token editor scoped to a change, the conflict message, and "Edit tokens
// in this change" on a change. Mounted by scripts/token-editor.ts and scripts/reviews.ts into server-rendered slots.
// Words and rules: lib/continue-change.ts.
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PenLine } from 'lucide-react';
import { Alert, Banner, Button, Link, Radio, RadioGroup } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import type { TargetOption } from '../../../lib/continue-change';

export interface TargetChoiceProps {
  options: TargetOption[];
  value: string;
  onChange: (value: string) => void;
}

/** Where the edits go: add to a change in review (default) or start a new change. */
export function TargetChoice({ options, value, onChange }: TargetChoiceProps) {
  return (
    <RadioGroup label="Where should these edits go?" name="ed-target" value={value} onValueChange={onChange}>
      {options.map((o) => (
        <Radio key={o.value} value={o.value} label={o.label} description={o.description} />
      ))}
    </RadioGroup>
  );
}

export interface ScopeBannerProps {
  title: string;
  body: string;
  /** The change page. */
  backHref: string;
  /** The same page viewing the change, read only (lib/view-scope): "Stop editing". */
  viewHref?: string;
}

/** Persistent while the token editor is scoped to a change: a neutral DS Banner, the mode (what is edited, where edits
 * go) and the ways out on the same line. */
export function ScopeBanner({ title, body, backHref, viewHref }: ScopeBannerProps) {
  return (
    <Banner
      appearance="neutral"
      icon={PenLine}
      title={title}
      actions={
        <>
          {viewHref && (
            <ButtonLink variant="secondary" href={viewHref}>
              Stop editing
            </ButtonLink>
          )}
          <ButtonLink variant="secondary" href={backHref}>
            Back to the change
          </ButtonLink>
        </>
      }
    >
      {body}
    </Banner>
  );
}

export interface ConflictNoticeProps {
  text: string;
  paths: string[];
  /** The change page, to compare both values. */
  href: string;
  onKeepMine: () => void;
  onKeepTheirs: () => void;
}

/** The save stopped: the same token was edited in the change since the editor loaded it. */
export function ConflictNotice({ text, paths, href, onKeepMine, onKeepTheirs }: ConflictNoticeProps) {
  // Token names in the sentence read in Plex Mono, like everywhere else in Studio.
  const escape = (p: string) => p.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  const parts = paths.length ? text.split(new RegExp('(' + paths.map(escape).join('|') + ')')) : [text];
  return (
    <Alert tone="warning" title="The same token changed in your edits and in the change" actions={
        <>
          <Button variant="primary" onClick={onKeepMine}>
            Keep mine
          </Button>
          <Button variant="secondary" onClick={onKeepTheirs}>
            Keep theirs
          </Button>
        </>
      }
    >
      <p>{parts.map((part, i) => (paths.includes(part) ? <code key={i}>{part}</code> : part))}</p>
      <p>
        <Link href={href}>Compare both values on the change</Link>
      </p>
      {paths.length > 1 && (
        <ul className="xe-conflict-list">
          {paths.slice(0, 6).map((p) => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

/** "Edit tokens in this change" on a change page: opens the token editor scoped to it. */
export function EditInChange({ href, label = 'Edit tokens in this change' }: { href: string; label?: string }) {
  return (
    <ButtonLink href={href} iconStart={PenLine}>
      {label}
    </ButtonLink>
  );
}

const roots = new WeakMap<HTMLElement, Root>();

/** Renders `node` into `el`, reusing its root on repaint. */
export function mountInto(el: HTMLElement, node: ReactNode): Root {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  root.render(node);
  return root;
}

/** Back from the token editor: what was just added to the change. */
export function AddedNotice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <Alert tone="success" onDismiss={onDismiss} dismissLabel="Dismiss this message">
      {text}
    </Alert>
  );
}

/** Mounts the added notice into `el`; dismissing removes it. */
export const mountAddedNotice = (el: HTMLElement, text: string) =>
  mountInto(
    el,
    <AddedNotice
      text={text}
      onDismiss={() => {
        unmountFrom(el);
        el.hidden = true;
      }}
    />,
  );

/** Mounts "Edit tokens in this change" into a change page slot. */
export const mountEditInChange = (el: HTMLElement, href: string) => mountInto(el, <EditInChange href={href} />);

/** Unmounts what `mountInto` rendered into `el`. */
export function unmountFrom(el: HTMLElement | null) {
  if (!el) return;
  roots.get(el)?.unmount();
  roots.delete(el);
}
