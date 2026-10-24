// One row of the "waiting on you" queue (Studio home Needs you, the review queue, join requests in Settings > Members
// and on the home of a team with no design system yet): before/after or the person, what and why, the status on the
// right (the shared BranchRow). A join request carries Decline and Approve in the row; after a decision the row goes
// and a toast says what happened, with Undo (needs a ToastProvider above). Words: lib/home-model.ts, lib/entry.ts.
import { useState, type MouseEvent } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import { Button, Icon, useToast } from '@bridge-ds/react';
import { Who } from './faces';
import { BranchRow } from './BranchRow';
import ButtonLink from '../ButtonLink';
import { rowAction, type NeedRow } from '../../../lib/home-model';
import { ENTRY_WORDS } from '../../../lib/entry';
// The row styles (sh-rows, sh-join), also on pages that are not a home (Settings > Members).
import '../../../styles/studio-home.css';

/** What deciding on a join request gave: the line for the toast (`undo`: it can be taken back), or why it did not happen. */
export type JoinOutcome = { ok: true; text: string; undo?: boolean } | { ok: false; github: boolean; text: string };

export interface JoinHandlers {
  /** Approve or decline; on success the row leaves the list at once and the home recounts. */
  decide: (row: NeedRow, approve: boolean) => Promise<JoinOutcome>;
  /** Takes the decision back for a short while: the request waits again. */
  undo?: (row: NeedRow) => Promise<JoinOutcome>;
  /** No GitHub admin account linked: "Connect GitHub to manage requests". */
  connectGitHub: () => void;
}

/** How long the toast offers Undo (the server keeps the decision undoable for 30 seconds). */
const UNDO_MS = 8000;

/** Decline and Approve on a join request. After a decision the row goes and a short toast says what happened, with Undo. */
function JoinActions({ row, join, action = 'secondary' }: { row: NeedRow; join: JoinHandlers; action?: 'primary' | 'secondary' }) {
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [out, setOut] = useState<JoinOutcome | null>(null);
  const toast = useToast();
  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'decline');
    const o = await join.decide(row, approve);
    if (o.ok) {
      const undo = join.undo;
      const id = toast.add({
        title: o.text,
        tone: o.undo ? 'success' : 'neutral',
        timeout: o.undo && undo ? UNDO_MS : undefined,
        action:
          o.undo && undo
            ? {
                label: ENTRY_WORDS.undo,
                onClick: () => {
                  void undo(row).then((u) => {
                    if (!u.ok) return void toast.add({ title: u.text || ENTRY_WORDS.githubToManage, tone: 'danger' });
                    // Taken back: the decision's toast and its Undo go, the new one says so.
                    toast.close(id);
                    toast.add({ title: u.text, tone: 'neutral' });
                  });
                },
              }
            : undefined,
      });
      return;
    }
    setOut(o);
    setBusy(null);
  };
  if (out && !out.ok && out.github)
    return (
      <span className="sh-join">
        <Button variant="link" onClick={join.connectGitHub}>
          {ENTRY_WORDS.githubToManage}
        </Button>
      </span>
    );
  const who = row.request?.name ?? row.title;
  return (
    <span className="sh-join">
      {out && !out.ok && (
        <span className="t-ui t-muted" role="status">
          {out.text}
        </span>
      )}
      <Button variant="secondary" loading={busy === 'decline'} disabled={Boolean(busy)} aria-label={`${ENTRY_WORDS.decline} ${who}`} onClick={() => void decide(false)}>
        {ENTRY_WORDS.decline}
      </Button>
      {/* Approve is the view's primary only when the row is (a lone row on the home): one primary action per view. */}
      <Button variant={action} loading={busy === 'approve'} disabled={Boolean(busy)} aria-label={`${ENTRY_WORDS.approve} ${who}`} onClick={() => void decide(true)}>
        {ENTRY_WORDS.approve}
      </Button>
    </span>
  );
}

/** One Needs you row: before/after, who, what and why, the status on the right (the shared BranchRow). */
export function NeedRowItem({ row, selected, onSelect, action, compact, join }: { row: NeedRow; selected?: boolean; onSelect?: (row: NeedRow) => void; action?: 'primary' | 'secondary'; compact?: boolean; join?: JoinHandlers }) {
  const click = onSelect
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onSelect(row);
      }
    : undefined;
  return (
    <BranchRow
      thumb={row.thumb}
      who={row.person ? <Who p={row.person} /> : <span className="sh-row-icon"><Icon icon={row.pill?.tone === 'danger' ? TriangleAlert : Check} size="md" /></span>}
      title={row.title}
      href={row.href}
      onClick={click}
      selected={selected}
      line={row.line}
      pill={row.pill}
      compact={compact}
      detail={row.detail}
      end={
        action && row.kind === 'join' && join ? (
          <JoinActions row={row} join={join} action={action} />
        ) : (
          action && (
          <ButtonLink variant={action} href={row.href} className="sh-row-action" tabIndex={-1} aria-hidden="true">
            {rowAction(row.kind, row.action)}
          </ButtonLink>
          )
        )
      }
    />
  );
}

export function NeedList({ rows, selectedKey, onSelect, label = 'Needs you', action, compact, join }: { rows: NeedRow[]; selectedKey?: string | null; onSelect?: (row: NeedRow) => void; label?: string; action?: 'primary' | 'secondary'; compact?: boolean; join?: JoinHandlers }) {
  return (
    <ul className="sh-rows" aria-label={label}>
      {rows.map((r) => (
        <NeedRowItem key={r.key} row={r} selected={selectedKey === r.key} onSelect={onSelect} action={action} compact={compact} join={join} />
      ))}
    </ul>
  );
}
