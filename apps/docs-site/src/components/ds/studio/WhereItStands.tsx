// "Where it stands" on the exploration page: the handover notes another designer (or another AI tool) carries on
// from. Progressive disclosure: the next step and the counts first, the context, decisions, edge cases (one checklist
// per component, the DS Checklist rows: covered or still open) and open questions on "Show details". Whoever can edit
// the exploration edits it in place (one form, the sections whole); readers see it read only. Empty: one quiet line on
// how it fills itself when someone works in Claude. Data and the save: scripts/exploration-page.ts; words:
// lib/exploration-notes-view.ts; styles: styles/exploration-page.css (.xp-notes).
import { useId, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, ButtonGroup, Checkbox, Checklist, ChecklistRow, IconButton, Input, Skeleton, Textarea } from '@bridge-ds/react';
import type { ExplorationNotes, NotesUpdate } from '@bridge-ds/core';
import { Drawing } from './Drawing';
import { draftOf, edgeCaseGroups, NOTES_WORDS as W, notesCountLine, notesEmpty, notesHaveDetails, updateOfDraft, type NotesDraft } from '../../../lib/exploration-notes-view';

export interface WhereItStandsView {
  /** null while it is read. */
  notes: ExplorationNotes | null;
  /** Saves an edit (the sections the person changed); null for a reader. */
  onSave?: ((update: NotesUpdate) => Promise<string | void>) | null;
}

export function WhereItStands({ view, say }: { view: WhereItStandsView; say: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const detailsId = useId();
  const n = view.notes;
  const canEdit = Boolean(view.onSave);
  return (
    <section className="xp-notes" aria-labelledby="xp-notes-h">
      <div className="xp-notes-head">
        <h2 className="xp-h2" id="xp-notes-h">
          {W.title}
        </h2>
        {/* The action on the line of what it acts on. */}
        {n && canEdit && !editing && !notesEmpty(n) && (
          <Button variant="secondary" size="md" onClick={() => setEditing(true)}>
            {W.edit}
          </Button>
        )}
      </div>
      {n === null ? (
        <Skeleton variant="rect" className="xp-skel-rows" />
      ) : editing ? (
        <NotesForm notes={n} onSave={view.onSave!} onDone={() => setEditing(false)} say={say} />
      ) : notesEmpty(n) ? (
        <div className="xp-notes-empty">
          <Drawing name="guide" width={56} className="xp-notes-art" />
          <p className="xp-muted">
            {W.empty}
            {canEdit && (
              <>
                {' '}
                <Button variant="link" size="sm" onClick={() => setEditing(true)}>
                  {W.write}
                </Button>
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="xp-notes-next">
            <h3 className="xp-h3">{W.next}</h3>
            <p className={n.nextStep ? 'xp-notes-text' : 'xp-muted'}>{n.nextStep || W.noNext}</p>
          </div>
          {notesHaveDetails(n) && (
            <div className="xp-notes-sum">
              <span className="xp-muted">{notesCountLine(n) || W.context}</span>
              <Button variant="link" size="sm" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}>
                {open ? W.hide : W.show}
              </Button>
            </div>
          )}
          <div id={detailsId} className="xp-notes-details" hidden={!open}>
            {open && <NotesDetails n={n} />}
          </div>
        </>
      )}
    </section>
  );
}

function NotesDetails({ n }: { n: ExplorationNotes }) {
  return (
    <>
      {n.context && (
        <div className="xp-notes-part">
          <h3 className="xp-h3">{W.context}</h3>
          <p className="xp-notes-text">{n.context}</p>
        </div>
      )}
      {n.decisions.length > 0 && (
        <div className="xp-notes-part">
          <h3 className="xp-h3">{W.decisions}</h3>
          <ul className="xp-notes-list">
            {n.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {n.edgeCases.length > 0 && (
        <div className="xp-notes-part">
          <h3 className="xp-h3">{W.edgeCases}</h3>
          {edgeCaseGroups(n.edgeCases).map((g) => (
            <div key={g.component} className="xp-notes-group">
              <p className="xp-muted xp-notes-comp" aria-hidden="true">
                {g.component}
              </p>
              <Checklist label={g.component} className="xp-notes-cases">
                {g.cases.map((e, i) => (
                  <ChecklistRow key={i} status={e.covered ? 'done' : 'waiting'} statusLabel={e.covered ? W.covered : W.open} title={e.state} detail={e.note} />
                ))}
              </Checklist>
            </div>
          ))}
        </div>
      )}
      {n.openQuestions.length > 0 && (
        <div className="xp-notes-part">
          <h3 className="xp-h3">{W.questions}</h3>
          <ul className="xp-notes-list">
            {n.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** The whole notes in one form: the next step first, the lists one line each, the edge cases one row each. */
function NotesForm({ notes, onSave, onDone, say }: { notes: ExplorationNotes; onSave: NonNullable<WhereItStandsView['onSave']>; onDone: () => void; say: (s: string) => void }) {
  const [d, setD] = useState<NotesDraft>(() => draftOf(notes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<NotesDraft>) => setD((x) => ({ ...x, ...patch }));
  const setCase = (i: number, patch: Partial<NotesDraft['edgeCases'][number]>) => setD((x) => ({ ...x, edgeCases: x.edgeCases.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const update = updateOfDraft(notes, d);
    if (!Object.keys(update).length) return onDone();
    setBusy(true);
    setError(null);
    onSave(update)
      .then((r) => {
        say(r || W.saved);
        onDone();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const last = d.edgeCases[d.edgeCases.length - 1];
  return (
    <form className="xp-notes-form" onSubmit={submit} noValidate>
      <Textarea label={W.next} rows={2} value={d.nextStep} onChange={(e) => set({ nextStep: e.target.value })} autoFocus />
      <Textarea label={W.context} rows={3} value={d.context} onChange={(e) => set({ context: e.target.value })} />
      <Textarea label={W.decisions} hint={W.linesHint} rows={3} value={d.decisions} onChange={(e) => set({ decisions: e.target.value })} />
      <fieldset className="xp-notes-cases-edit">
        <legend className="xp-h3">{W.edgeCases}</legend>
        {d.edgeCases.map((c, i) => (
          <div key={i} className="xp-case-row">
            <div className="xp-case-fields">
              <Input label="Component" value={c.component} onValueChange={(v) => setCase(i, { component: v })} />
              <Input label="State" value={c.state} onValueChange={(v) => setCase(i, { state: v })} />
              <div className="xp-case-note">
                <Input label="Note" value={c.note ?? ''} onValueChange={(v) => setCase(i, { note: v })} />
              </div>
            </div>
            <div className="xp-case-acts">
              <Checkbox label={W.covered} checked={c.covered} onCheckedChange={(v) => setCase(i, { covered: v })} />
              <IconButton icon={X} label={W.removeCase} variant="ghost" size="md" onClick={() => setD((x) => ({ ...x, edgeCases: x.edgeCases.filter((_, j) => j !== i) }))} />
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="md"
          iconStart={Plus}
          className="xp-case-add"
          onClick={() => setD((x) => ({ ...x, edgeCases: [...x.edgeCases, { component: last?.component ?? '', state: '', covered: false }] }))}
        >
          {W.addCase}
        </Button>
      </fieldset>
      <Textarea label={W.questions} hint={W.linesHint} rows={2} value={d.openQuestions} onChange={(e) => set({ openQuestions: e.target.value })} />
      {error && (
        <p className="xp-notes-error" role="alert">
          {error}
        </p>
      )}
      <ButtonGroup>
        <Button type="submit" variant="primary" size="md" loading={busy}>
          {W.save}
        </Button>
        <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onDone}>
          {W.cancel}
        </Button>
      </ButtonGroup>
    </form>
  );
}
