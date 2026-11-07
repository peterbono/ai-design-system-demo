// The talk between a designer and their design lead on the exploration page (boards L1 to L5):
// - LeadBar, the review bar at the bottom of the page while it waits for a lead (the same bar as the review queue):
//   a comment, Comment (a question, no verdict), Needs changes (needs words), Looks right (words optional, they go to
//   the developers), and "..." with Ask someone else to review, Not doing this and Copy link.
// - DesignerZone, what the lead said for the designer to read and answer, the page's one Harbor zone.
// - NotDoingZone, the end of an exploration a lead decided against, with the reason.
// - Decisions, everything said, newest first.
// - WhyDialog, a reason before a lead's act on someone else's work, and HandOverDialog.
// Words and rules: lib/lead-decisions.ts. Styles: styles/exploration-page.css (xp-lead-*).
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button, ButtonGroup, Dialog, DialogClose, DialogContent, IconButton, Input, Menu, MenuContent, MenuItem, MenuTrigger, Select, Textarea, Tooltip } from '@bridge-ds/react';
import { Ellipsis } from 'lucide-react';
import { Who } from './faces';
import type { PageFace } from '../../../lib/exploration-page';
import type { DecisionRowView } from '../../../lib/lead-decisions';

export interface LeadBarView {
  onLooksRight: (note: string) => Promise<string | void>;
  onChanges: (note: string) => Promise<string | void>;
  onComment: (text: string) => Promise<string | void>;
  onNotDoing: (reason: string) => Promise<string | void>;
  /** The other leads' names: unset when there is nobody else to ask. */
  onAskOther?: (() => Promise<string | void>) | null;
  link: string;
  onCopy: (text: string) => Promise<void>;
  /** It changed since the designer asked: the preview already shows the new version. */
  changedSince?: boolean;
}

type Busy = 'right' | 'changes' | 'comment' | null;

export function LeadBar({ bar, say }: { bar: LeadBarView; say: (s: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [no, setNo] = useState(false);
  const words = text.trim();
  const send = (b: Exclude<Busy, null>, act: Promise<string | void>) => {
    setBusy(b);
    act
      .then((r) => {
        if (r) say(r);
        setText('');
      })
      .catch((err: Error) => say(err.message))
      .finally(() => setBusy(null));
  };
  return (
    <div className="xp-lead-bar" role="region" aria-label="Your answer">
      {bar.changedSince && <p className="xp-muted">Changed since you were asked. The preview shows the latest version.</p>}
      <div className="xp-lead-bar-row">
        <div className="xp-lead-bar-field">
          <Input label="Comment" hideLabel size="lg" placeholder="Add a comment" value={text} onValueChange={setText} />
        </div>
        <Button variant="secondary" size="lg" disabled={!words || busy !== null} loading={busy === 'comment'} onClick={() => send('comment', bar.onComment(words))}>
          Comment
        </Button>
        <Button variant="secondary" size="lg" disabled={!words || busy !== null} loading={busy === 'changes'} onClick={() => send('changes', bar.onChanges(words))}>
          Needs changes
        </Button>
        <Button variant="primary" size="lg" disabled={busy !== null} loading={busy === 'right'} onClick={() => send('right', bar.onLooksRight(words))}>
          Looks right
        </Button>
        <Menu>
          <Tooltip content="More actions">
            <MenuTrigger render={<IconButton icon={Ellipsis} label="More actions" variant="secondary" size="lg" />} />
          </Tooltip>
          <MenuContent side="top" align="end">
            {bar.onAskOther && (
              <MenuItem
                onClick={() => {
                  bar
                    .onAskOther!()
                    .then((r) => r && say(r))
                    .catch((err: Error) => say(err.message));
                }}
              >
                Ask someone else to review
              </MenuItem>
            )}
            <MenuItem onClick={() => setNo(true)}>Not doing this</MenuItem>
            <MenuItem onClick={() => void bar.onCopy(bar.link).then(() => say('Link copied.'), () => say('Could not copy the link.'))}>Copy link</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <WhyDialog
        open={no}
        onOpenChange={setNo}
        title="Not doing this?"
        description="It ends here, with your reason. The work stays on this page. They read it here and by email."
        confirm="Not doing this"
        onConfirm={(why) => bar.onNotDoing(why).then((r) => void (r && say(r)))}
      />
    </div>
  );
}

function Quote({ who, when, text }: { who: PageFace; when: string; text: string }) {
  return (
    <figure className="xp-lead-quote">
      <figcaption className="xp-muted">
        <Who p={{ login: who.login, name: who.name, agent: who.agent, avatar: who.avatar }} size="xs" />
        {who.name}, {when}
      </figcaption>
      <blockquote>{text}</blockquote>
    </figure>
  );
}

export interface DesignerZoneView {
  title: string;
  who: PageFace;
  when: string;
  text: string;
  /** Their answer, for the person it waits on. Unset: the zone only says where it stands. */
  onSend?: ((text: string) => Promise<string | void>) | null;
  /** "Send back to Florian", "Answer Florian". */
  sendLabel: string;
  /** A question needs the words; changes can go back without any. */
  required: boolean;
  fieldLabel: string;
  placeholder: string;
  /** Under the zone, for the question. */
  note?: string | null;
}

export function DesignerZone({ z, say, extra }: { z: DesignerZoneView; say: (s: string) => void; extra?: ReactNode }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!z.onSend || (z.required && !text.trim())) return;
    setBusy(true);
    z.onSend(text)
      .then((r) => r && say(r))
      .catch((err: Error) => say(err.message))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <section className="xp-done zone" aria-labelledby="xp-ask-h">
        <h2 className="xp-h2" id="xp-ask-h">
          {z.title}
        </h2>
        <Quote who={z.who} when={z.when} text={z.text} />
        {z.onSend && (
          <form className="xp-lead-form" onSubmit={send}>
            <Textarea label={z.fieldLabel} placeholder={z.placeholder} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="xp-lead-acts">
              <Button type="submit" variant="primary" size="md" loading={busy} disabled={z.required && !text.trim()}>
                {z.sendLabel}
              </Button>
              {extra}
            </div>
          </form>
        )}
      </section>
      {z.note && <p className="xp-muted">{z.note}</p>}
    </>
  );
}

export interface NotDoingView {
  who: PageFace;
  when: string;
  text: string;
  title: string;
  onReopen?: (() => Promise<string | void>) | null;
}

export function NotDoingZone({ v, say }: { v: NotDoingView; say: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="xp-done zone" aria-labelledby="xp-no-h">
      <h2 className="xp-h2" id="xp-no-h">
        {v.title}
      </h2>
      <Quote who={v.who} when={v.when} text={v.text} />
      <p>Your work stays here. Nothing goes to the developers.</p>
      {v.onReopen && (
        <Button
          variant="inverse"
          size="md"
          className="xp-done-btn"
          loading={busy}
          onClick={() => {
            setBusy(true);
            v.onReopen!()
              .then((r) => r && say(r))
              .catch((err: Error) => say(err.message))
              .finally(() => setBusy(false));
          }}
        >
          Reopen as a new exploration
        </Button>
      )}
    </section>
  );
}

export function Decisions({ rows, when }: { rows: readonly DecisionRowView[]; when: (iso: string) => string }) {
  if (!rows.length) return null;
  return (
    <section className="xp-activity" aria-labelledby="xp-dec-h">
      <h2 className="xp-h2" id="xp-dec-h">
        Decisions
      </h2>
      <ul className="xp-rows">
        {rows.map((r) => (
          <li key={r.key} className="xp-row">
            <Who p={{ login: r.login, name: r.name, agent: false, avatar: null }} size="xs" />
            <span className="xp-row-text">
              <strong>{r.name}</strong> {r.verb}
              {r.why && <span className="xp-muted xp-lead-why">{r.why}</span>}
              <span className="xp-muted xp-lead-why">Round {r.round}</span>
            </span>
            <span className="xp-muted xp-when">{when(r.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A reason before an act on someone else's work: nothing happens without it. */
export function WhyDialog(p: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirm: string; label?: string; onConfirm: (why: string) => Promise<void> }) {
  const formId = useId();
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (p.open) {
      setWhy('');
      setError(null);
    }
  }, [p.open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!why.trim()) return setError('Say why: they read it.');
    setBusy(true);
    p.onConfirm(why.trim())
      .then(() => p.onOpenChange(false))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={p.open} onOpenChange={(o) => !busy && p.onOpenChange(o)}>
      <DialogContent
        title={p.title}
        description={p.description}
        size="sm"
        hideClose
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="secondary" disabled={busy} />}>Cancel</DialogClose>
            <Button type="submit" form={formId} variant="primary" loading={busy}>
              {p.confirm}
            </Button>
          </ButtonGroup>
        }
      >
        <form id={formId} onSubmit={submit}>
          <Textarea label={p.label ?? 'Why'} rows={3} value={why} onChange={(e) => setWhy(e.target.value)} {...(error ? { error } : {})} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface HandOverPerson {
  value: string;
  label: string;
}

/** Take over or hand over: who keeps it now, and why. */
export function HandOverDialog(p: { open: boolean; onOpenChange: (o: boolean) => void; people: readonly HandOverPerson[]; onConfirm: (to: string, why: string) => Promise<void> }) {
  const formId = useId();
  const [to, setTo] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (p.open) {
      setTo(p.people[0]?.value ?? '');
      setWhy('');
      setError(null);
    }
  }, [p.open, p.people]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!why.trim()) return setError('Say why: they read it.');
    setBusy(true);
    p.onConfirm(to, why.trim())
      .then(() => p.onOpenChange(false))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={p.open} onOpenChange={(o) => !busy && p.onOpenChange(o)}>
      <DialogContent
        title="Hand this exploration over"
        description="They carry it on from here, with its preview, notes and decisions."
        size="sm"
        hideClose
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="secondary" disabled={busy} />}>Cancel</DialogClose>
            <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!to}>
              Hand over
            </Button>
          </ButtonGroup>
        }
      >
        <form id={formId} className="xp-lead-form" onSubmit={submit}>
          <Select label="To" value={to} onValueChange={(v) => setTo(v ?? '')} options={p.people.map((x) => ({ value: x.value, label: x.label }))} />
          <Textarea label="Why" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} {...(error ? { error } : {})} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Developers already started: it stays with them, and a word still reaches them. */
export function TellDevelopers({ onSend, say }: { onSend: (text: string) => Promise<string | void>; say: (s: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="xp-lead-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        onSend(text)
          .then((r) => {
            if (r) say(r);
            setText('');
          })
          .catch((err: Error) => say(err.message))
          .finally(() => setBusy(false));
      }}
    >
      <Textarea label="Developers already started" hint="It stays with them. Your words reach them on their task." rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="xp-lead-acts">
        <Button type="submit" variant="secondary" size="md" loading={busy} disabled={!text.trim()}>
          Send to the developers
        </Button>
      </div>
    </form>
  );
}

/**
 * The product manager of the exploration's product (boards R1 and R3). Their own view: "What do you think?", a note and
 * Looks good or Needs changes (the note needed), in place of the designer's Harbor zone. Everyone else who talks about
 * it (its designer, the leads): where the PM stands in one line, their note, and for the designer, the PM agreed in a call.
 */
export interface PmView {
  /** The viewer is the PM. */
  mine: boolean;
  title: string;
  intro: string;
  /** Where the PM stands, one line. */
  line: string;
  quote?: { who: PageFace; when: string; text: string } | null;
  onSay?: ((kind: 'pm-ok' | 'pm-changes', text: string) => Promise<string | void>) | null;
  /** The designer's word that the PM agreed in a call (label: "Dino agreed in a call"). */
  call?: { label: string; onCall: () => Promise<string | void> } | null;
}

export function PmZone({ v, say }: { v: PmView; say: (s: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'pm-ok' | 'pm-changes' | null>(null);
  const send = (kind: 'pm-ok' | 'pm-changes') => {
    if (!v.onSay || (kind === 'pm-changes' && !text.trim())) return;
    setBusy(kind);
    v.onSay(kind, text.trim())
      .then((r) => {
        setText('');
        if (r) say(r);
      })
      .catch((err: Error) => say(err.message))
      .finally(() => setBusy(null));
  };
  return (
    <section className="xp-done zone" aria-labelledby="xp-pm-h">
      <h2 className="xp-h2" id="xp-pm-h">
        {v.title}
      </h2>
      <p>{v.intro}</p>
      <p className="xp-muted">{v.line}</p>
      {v.onSay && (
        <form
          className="xp-lead-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send('pm-ok');
          }}
        >
          <Textarea label="Your note" hint="Needed for Needs changes." rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="xp-pm-acts">
            <Button type="submit" variant="inverse" size="md" loading={busy === 'pm-ok'} disabled={busy !== null}>
              Looks good
            </Button>
            <Button type="button" variant="secondary" size="md" loading={busy === 'pm-changes'} disabled={!text.trim() || busy !== null} onClick={() => send('pm-changes')}>
              Needs changes
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function PmStatus({ v, say }: { v: PmView; say: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="xp-pm" aria-labelledby="xp-pm-s">
      <h2 className="xp-h2" id="xp-pm-s">
        Product manager
      </h2>
      <p>{v.line}</p>
      {v.quote && <Quote who={v.quote.who} when={v.quote.when} text={v.quote.text} />}
      {v.call && (
        <Button
          variant="secondary"
          size="md"
          loading={busy}
          onClick={() => {
            setBusy(true);
            v.call!
              .onCall()
              .then((r) => r && say(r))
              .catch((err: Error) => say(err.message))
              .finally(() => setBusy(false));
          }}
        >
          {v.call.label}
        </Button>
      )}
    </section>
  );
}
