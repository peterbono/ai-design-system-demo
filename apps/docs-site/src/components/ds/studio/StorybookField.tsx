// The Storybook quick start field (plan section 5), on onboarding step 2 and on the Storybook components page when
// nothing is added yet. "Add Storybook" reads the Storybook's index (scripts/storybook-source.ts), so the address is
// validated by what it holds, then keeps it in this browser (scripts/workspace.ts). Once added, it says what was
// found, in one line, with the way to see it and to change it.
import { useState, type FormEvent } from 'react';
import { Check, Eye } from 'lucide-react';
import { Button, Icon, Input, Link } from '@bridge-ds/react';
import { loadStorybook, StorybookLoadError, type LoadedStorybook } from '../../../scripts/storybook-source';
import { clearStorybook, saveStorybook } from '../../../scripts/workspace';
import { storybookErrorLine, storybookRows } from '../../../lib/storybook-view';
import { storybookHost, type WorkspaceStorybook } from '../../../lib/workspace';
import { studioHref } from '../../../lib/team-path';

export const STORYBOOK_PAGE = studioHref('components/storybook/');

/** What a loaded Storybook saves to the workspace. */
export function toWorkspace(loaded: LoadedStorybook, now = new Date()): WorkspaceStorybook {
  const rows = storybookRows(loaded.index);
  return { url: loaded.base, components: rows.length, stories: rows.reduce((n, r) => n + r.stories, 0), checkedAt: now.toISOString() };
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export interface StorybookFieldProps {
  /** The Storybook already added in this browser. */
  saved: WorkspaceStorybook | null;
  /** Called once a Storybook is read and saved. */
  onAdded?: (loaded: LoadedStorybook) => void;
  /** Show "See them" once added (off on the page that already lists them). */
  seeLink?: boolean;
  /** The id prefix, so two fields on one page keep unique ids. */
  id?: string;
  /** A value to start from (a suggestion the viewer picked). */
  initial?: string;
  /** Opens on the field even when a Storybook is saved, and calls this on Cancel instead of showing it. */
  onCancel?: () => void;
  /** The submit's weight: primary on its own, secondary inside a view that already has a primary. */
  variant?: 'primary' | 'secondary';
}

export function StorybookField({ saved, onAdded, seeLink = true, id = 'sb-url', initial, onCancel, variant = 'primary' }: StorybookFieldProps) {
  const [editing, setEditing] = useState(!saved || Boolean(onCancel));
  const [value, setValue] = useState(saved?.url ?? initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (saved && !editing) {
    return (
      <div className="sbq-added" role="status">
        <p className="sbq-added-line">
          <Icon icon={Check} size="sm" />
          <span>
            <b className="sbq-strong">{plural(saved.components, 'component')}</b> from <span className="mono">{storybookHost(saved.url)}</span>
          </span>
        </p>
        <p className="sbq-added-actions">
          {seeLink && <Link href={STORYBOOK_PAGE}>See them</Link>}
          <Button variant="link" onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button
            variant="link"
            onClick={() => {
              clearStorybook();
              setValue('');
              setEditing(true);
            }}
          >
            Remove
          </Button>
        </p>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) {
      setError(storybookErrorLine('invalid-url'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadStorybook(value, { fresh: true });
      if (!storybookRows(loaded.index).length) throw new StorybookLoadError('empty', 'empty');
      saveStorybook(toWorkspace(loaded));
      setEditing(false);
      onAdded?.(loaded);
      onCancel?.();
    } catch (err) {
      setError(storybookErrorLine(err instanceof StorybookLoadError ? err.code : 'network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sbq-form" onSubmit={submit} noValidate>
      <Input
        id={id}
        label="Storybook URL"
        type="url"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder="https://storybook.your-company.com"
        value={value}
        onValueChange={(v) => {
          setValue(v);
          if (error) setError(null);
        }}
        error={error ?? undefined}
      />
      <p className="sbq-note">
        <Icon icon={Eye} size="sm" />
        Read only. No access to your code.
      </p>
      <span className="sbq-form-actions">
        <Button type="submit" variant={variant} loading={busy} disabled={busy}>
          {busy ? 'Reading your Storybook' : 'Add Storybook'}
        </Button>
        {(saved || onCancel) && (
          <Button variant="ghost" onClick={() => (onCancel ? onCancel() : setEditing(false))} disabled={busy}>
            Cancel
          </Button>
        )}
      </span>
    </form>
  );
}
