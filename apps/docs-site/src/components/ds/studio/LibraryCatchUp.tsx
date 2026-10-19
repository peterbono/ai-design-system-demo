// "Bring in the latest library" on a change (Changes > a change, the Latest library row of its checklist). Two
// actions, one place: when nothing conflicts, GitHub brings the library in (update-branch); when the change and the
// library changed the same tokens, the designer resolves them here, one row per token, "Keep mine" (the default) or
// "Use the library's", the Tokens Studio yours/theirs model in designer words. The contrast guardrail runs on the
// choices before anything is sent. DS Button, Dialog, ChoiceCardGroup, TokenValue and Alert, mounted by scripts/reviews.ts.
import { useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Alert, Button, ButtonGroup, ChoiceCard, ChoiceCardGroup, Dialog, DialogClose, DialogContent, TokenValue, type TokenValueSize } from '@bridge-ds/react';
import type { MergeChoices, MergeSide, TokenMergeConflict } from '@bridge-ds/core';
import { resolution, type ConflictRow, type Guardrail } from '../../../lib/library-sync';
import type { ShownValue } from '../../../lib/token-review';
import { VOCAB } from '../../../lib/vocabulary';

export interface ResolverSource {
  conflicts: TokenMergeConflict[];
  rows: ConflictRow[];
  /** What happens after: checks run again, approvals. */
  next: string;
  /** The contrast guardrail of these choices (pure, runs on every pick). */
  check: (choices: MergeChoices) => Guardrail;
  /** Commits the choices to the change. Throws with a sentence that says how to fix it. */
  apply: (choices: MergeChoices) => Promise<void>;
}

export interface LibraryCatchUpProps {
  /** The button label: "Bring in the latest library", "Resolve 2 conflicts". */
  label: string;
  /** The view's one primary action. */
  primary: boolean;
  /** No conflict: GitHub brings the library in. Errors are shown by the caller, on the row. */
  onUpdate?: () => Promise<void>;
  /** A token conflict, or token files to combine: the resolver dialog. */
  resolver?: ResolverSource;
}

function Value({ v, size }: { v: ShownValue | null; size?: TokenValueSize }) {
  if (!v) return <>Removes the token</>;
  return <TokenValue size={size} value={v.alias ? `{${v.alias}}` : (v.css ?? '')} resolved={v.alias ? (v.css ?? undefined) : undefined} swatch={v.hex ?? false} />;
}

function ConflictRows({ rows, choices, pick }: { rows: ConflictRow[]; choices: MergeChoices; pick: (key: string, side: MergeSide) => void }) {
  return (
    <ul className="lib-rows" aria-label="Tokens to decide">
      {rows.map((r) => {
        const choice = choices[r.key] ?? r.defaultChoice;
        return (
          <li className="lib-row" key={r.key}>
            <div className="lib-token">
              <span className="lib-name mono">{r.name}</span>
              <span className="lib-meta">
                {[r.context, r.base ? null : 'Added on both sides'].filter(Boolean).join(', ')}
                {r.base && (
                  <>
                    {r.context ? ', was ' : 'Was '}
                    <Value v={r.base} size="sm" />
                  </>
                )}
              </span>
              {r.note && <span className={r.mustPick ? 'lib-note is-pick' : 'lib-note'}>{r.note}</span>}
            </div>
            <ChoiceCardGroup
              label={`Value of ${r.name}${r.context ? ` in ${r.context}` : ''}`}
              hideLabel
              value={choice ?? ''}
              onValueChange={(v) => pick(r.key, v as MergeSide)}
            >
              <ChoiceCard value="mine" title="Keep mine" description={<Value v={r.mine} />} />
              <ChoiceCard value="theirs" title="Use the library's" description={<Value v={r.library} />} />
            </ChoiceCardGroup>
          </li>
        );
      })}
    </ul>
  );
}

function Resolver({ source, label, primary }: { source: ResolverSource; label: string; primary: boolean }) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<MergeChoices>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = resolution(source.conflicts, choices);
  // The guardrail runs as soon as every token has a value: the designer sees the contrast result before sending.
  const guard = useMemo(() => (open && plan.ready ? source.check(choices) : null), [open, plan.ready, choices, source]);
  const n = source.conflicts.length;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await source.apply(choices);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <Button variant={primary ? 'primary' : 'secondary'} size="md" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <DialogContent
        size="lg"
        title={n ? label : VOCAB.updateFromMain}
        description={
          n
            ? "These tokens changed in this branch and on main. Keep yours or use the ones on main. Everything else from both sides is combined."
            : 'The same token files changed on both sides, but no token changed twice. Bridge combines them.'
        }
        footer={
          <div className="lib-foot">
            <p className="lib-plan" aria-live="polite">
              {plan.sentence}
            </p>
            <ButtonGroup align="end">
              <DialogClose render={<Button variant="secondary" disabled={busy} />}>Cancel</DialogClose>
              <Button variant="primary" loading={busy} disabled={busy || !plan.ready} onClick={() => void apply()}>
                {busy ? 'Applying' : n ? 'Apply choices' : VOCAB.updateFromMain}
              </Button>
            </ButtonGroup>
          </div>
        }
      >
        {n > 0 && <ConflictRows rows={source.rows} choices={choices} pick={(key, side) => setChoices((c) => ({ ...c, [key]: side }))} />}
        {guard && (
          <Alert tone={guard.ok ? 'success' : 'warning'} announce="off" className="lib-guard" title={guard.sentence}>
            {guard.failing.length > 0 && (
              <ul className="lib-fails">
                {guard.failing.map((f) => (
                  <li key={`${f.pair}|${f.where}`}>
                    <span className="mono">{f.pair}</span>, {f.where}: {f.ratio}, needs {f.min}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <p className="lib-next">After you apply: {source.next.charAt(0).toLowerCase() + source.next.slice(1)}</p>
        {error && (
          <Alert tone="danger" className="lib-error" title="Nothing was sent">
            {error}
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Update({ label, primary, onUpdate }: { label: string; primary: boolean; onUpdate: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="md"
      loading={busy}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onUpdate().finally(() => setBusy(false));
      }}
    >
      {busy ? 'Bringing in the library' : label}
    </Button>
  );
}

export function LibraryCatchUp({ label, primary, onUpdate, resolver }: LibraryCatchUpProps) {
  if (resolver) return <Resolver source={resolver} label={label} primary={primary} />;
  if (onUpdate) return <Update label={label} primary={primary} onUpdate={onUpdate} />;
  return null;
}

/** Renders into `el`; call `unmount()` on the result before the detail is repainted. */
export function mountLibraryCatchUp(el: HTMLElement, props: LibraryCatchUpProps): Root {
  const root = createRoot(el);
  root.render(<LibraryCatchUp {...props} />);
  return root;
}
