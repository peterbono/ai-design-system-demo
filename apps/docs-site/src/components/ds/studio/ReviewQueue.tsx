// The review queue chrome (pages/studio/review.astro, scripts/review-queue-page.ts): the list on the start side
// ("‹ Home", "Review all · 3 of 20" with its progress, each row with what the viewer did to it) and the one bar at the
// bottom, about the item on screen only: comment, Suggest changes, Approve, More actions. The queue moves on after a
// decision; a toast says what was done, with Undo. Rules: lib/queue-nav.ts.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, Circle, CircleAlert, CircleDot, CircleX, Ellipsis, UserRoundPlus } from 'lucide-react';
import { Button, Icon, IconButton, Input, Kbd, Link, Menu, MenuContent, MenuItem, MenuSubmenu, MenuTrigger, Progress, SidebarNav, SidebarNavItem, SidebarNavSection, ToastProvider, Tooltip, useToast, type UseToastReturn } from '@bridge-ds/react';
import { positionLabel, queueWindow, type QueueOutcome } from '../../../lib/queue-nav';
import { Who, type Face } from './faces';
import { studioHref } from '../../../lib/team-path';

export interface QueueRow {
  key: string;
  title: string;
  /** Who waits on the viewer (a person or Claude); no face for rows without one. */
  person?: Face | null;
}

export interface QueueListProps {
  rows: QueueRow[];
  selected: string | null;
  outcomes: ReadonlyMap<string, QueueOutcome>;
  onSelect: (key: string) => void;
}

const MARK: Record<QueueOutcome | 'current' | 'todo', { icon: typeof Check; label: string }> = {
  approved: { icon: Check, label: 'Approved' },
  suggested: { icon: CircleAlert, label: 'Changes suggested' },
  asked: { icon: UserRoundPlus, label: 'Asked someone else' },
  declined: { icon: CircleX, label: 'Declined' },
  current: { icon: CircleDot, label: 'Open now' },
  todo: { icon: Circle, label: 'To review' },
};

export function QueueList({ rows, selected, outcomes, onSelect }: QueueListProps) {
  const index = rows.findIndex((r) => r.key === selected);
  const { end, more } = queueWindow(rows.length, index);
  const done = rows.filter((r) => outcomes.has(r.key)).length;
  return (
    <div className="rq-list">
      <Link variant="subtle" href={studioHref()} className="rq-home">
        <Icon icon={ChevronLeft} /> Home
      </Link>
      <p className="rq-count">
        <strong>Review all</strong>
        <span className="rq-muted"> · {index >= 0 ? positionLabel(rows.length, index) : `${rows.length} waiting`}</span>
      </p>
      <Progress value={done} max={Math.max(rows.length, 1)} size="sm" aria-label={`${done} of ${rows.length} done`} getAriaValueText={() => `${done} of ${rows.length} done`} />
      <SidebarNav aria-label="Waiting on you" className="rq-items">
        <SidebarNavSection>
        {rows.slice(0, end).map((r) => {
          const state = outcomes.get(r.key) ?? (r.key === selected ? 'current' : 'todo');
          const m = MARK[state];
          return (
            <SidebarNavItem
              key={r.key}
              href={`?item=${encodeURIComponent(r.key)}`}
              className={`rq-item-row is-${state}`}
              title={r.title}
              active={r.key === selected}
              onClick={(e) => {
                e.preventDefault();
                onSelect(r.key);
              }}
            >
              <Icon icon={m.icon} size="sm" className="rq-mark" label={m.label} />
              {r.person && <Who p={r.person} size="xs" className="rq-face" />}
              <span className="rq-item-text">{r.title}</span>
            </SidebarNavItem>
          );
        })}
        </SidebarNavSection>
        {more > 0 && <p className="rq-muted rq-more">and {more} more</p>}
      </SidebarNav>
    </div>
  );
}

/** Hosts the DS toasts of the queue and hands their API to the page script. */
export function QueueToasts({ onReady }: { onReady: (api: UseToastReturn) => void }) {
  return (
    <ToastProvider limit={2}>
      <ToastBridge onReady={onReady} />
    </ToastProvider>
  );
}

function ToastBridge({ onReady }: { onReady: (api: UseToastReturn) => void }) {
  const api = useToast();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
}

export interface QueueBarProps {
  /** The item on screen is a branch the viewer can approve. */
  canApprove: boolean;
  /** The viewer can suggest changes on it. */
  canSuggest: boolean;
  /** The item on screen is a branch (More actions applies). */
  branch: boolean;
  busy: 'approve' | 'suggest' | 'ask' | null;
  said: string;
  onApprove: (text: string) => void;
  onSuggest: (text: string) => void;
  onAsk: () => void;
  links: { review: string; developer: string } | null;
  /** Focus the comment field (S with an empty comment). */
  focusComment: number;
}

export function QueueBar(p: QueueBarProps) {
  const [text, setText] = useState('');
  const [said, setSaid] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (p.focusComment) field.current?.focus();
  }, [p.focusComment]);
  useEffect(() => {
    setSaid(p.said);
  }, [p.said]);
  const copy = async (url: string, what: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setSaid(`${what} copied.`);
    } catch {
      setSaid('Copy is not available in this browser. Copy the address from the address bar.');
    }
  };
  const suggest = () => {
    if (!text.trim()) {
      setSaid('Say what to change in the comment first.');
      field.current?.focus();
      return;
    }
    p.onSuggest(text.trim());
    setText('');
  };
  return (
    <div className="rq-bar" role="region" aria-label="Your review">
      <div className="rq-bar-row">
        <div className="rq-bar-field">
          <Input
            ref={field}
          label="Comment"
          hideLabel
          size="lg"
          placeholder="Add a comment (optional)"
          value={text}
          onValueChange={setText}
          disabled={!p.branch}
            data-rq-comment=""
          />
        </div>
        <Button variant="secondary" size="lg" disabled={!p.canSuggest || Boolean(p.busy)} loading={p.busy === 'suggest'} onClick={suggest}>
          Suggest changes
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={!p.canApprove || Boolean(p.busy)}
          loading={p.busy === 'approve'}
          onClick={() => {
            p.onApprove(text.trim());
            setText('');
          }}
        >
          Approve
        </Button>
        <Menu>
          <Tooltip content="More actions">
            <MenuTrigger render={<IconButton icon={Ellipsis} label="More actions" variant="secondary" size="lg" disabled={!p.branch} />} />
          </Tooltip>
          <MenuContent side="top" align="end">
            <MenuItem onClick={p.onAsk} disabled={!p.canApprove || Boolean(p.busy)}>
              Ask someone else to review
            </MenuItem>
            {p.links && (
              <MenuSubmenu label="Copy link">
                <MenuItem onClick={() => void copy(p.links!.review, 'Link to this review')}>Link to this review</MenuItem>
                <MenuItem onClick={() => void copy(p.links!.developer, 'Link for a developer')}>Link for a developer</MenuItem>
              </MenuSubmenu>
            )}
            {p.links && <MenuItem onClick={() => location.assign(p.links!.review)}>Open the full review</MenuItem>}
          </MenuContent>
        </Menu>
      </div>
      <p className="rq-bar-keys rq-muted">
        Keyboard: <Kbd keys="A" /> approve · <Kbd keys="S" /> suggest changes · <Kbd keys="J" /> <Kbd keys="K" /> next and previous
      </p>
      <p className="rq-said" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
