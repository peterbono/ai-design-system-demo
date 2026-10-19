// Try several changes together, on the Changes list (All changes, All open). Folded until asked: the bar at the end of
// the card says what trying together does, with one "Choose changes" button; it turns on a DS Checkbox at the start of
// each row (one target instead of one per row on the first screen). Then the bar holds the sentence of what happens
// next, "View the library with them" and "Try 3 changes together" (the view's primary while something is checked). The combination is computed here, in
// the browser, from the changes' own token edits on top of the latest library (@bridge-ds/core token-combine): tokens
// two changes set differently get one row each ("Use <change>'s", the rows of Bring in the latest library) and the
// contrast checks run on the result before anything opens. Code changes are left out and say why on their row.
// Mounted once by scripts/reviews.ts; the rows are HTML the list paints, so checkboxes and notes are portals into the
// slots each paint announces (ROWS_EVENT).
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Alert, Button, Checkbox, ChoiceCard, ChoiceCardGroup, Link, TokenValue, VisuallyHidden } from '@bridge-ds/react';
import { combineChanges, encodePicks, type CombinePicks } from '@bridge-ds/core';
import {
  ALONE_LABEL,
  CANCEL_LABEL,
  CHOOSE_LABEL,
  CODE_LINE,
  INTRO_LINE,
  combineSummary,
  keepListed,
  MIN_TOGETHER,
  ROWS_EVENT,
  selectionLine,
  togetherGuardrail,
  togetherRows,
  toggleChange,
  tryLabel,
  tryTogetherUrl,
  VIEW_LABEL,
  type RowsDetail,
} from '../../../lib/combine-changes';
import { reviewTokenChange } from '../../../lib/token-review';
import { viewTitle, viewTogetherHref } from '../../../lib/view-scope';
import { readLatestLibrary, readTogetherSource, type LatestLibrary, type TogetherSource } from '../../../scripts/combine-read';

interface Slot {
  number: number;
  box: HTMLElement;
  note: HTMLElement | null;
}

function readSlots(): Slot[] {
  return [...document.querySelectorAll<HTMLElement>('[data-together-slot]')].map((box) => ({
    number: Number(box.dataset.togetherSlot),
    box,
    note: document.querySelector<HTMLElement>(`[data-together-note="${box.dataset.togetherSlot}"]`),
  }));
}

export interface CombineChangesProps {
  /** Production admin (bridge.config.json previews.production.admin): where "Try them together" opens. */
  admin: string | null;
  /** Reads failed: the sentence that says how to fix it. */
  failure: (err: unknown) => string;
}

export function CombineChanges({ admin, failure }: CombineChangesProps) {
  const [rows, setRows] = useState<RowsDetail>({ show: false, listed: [] });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [refused, setRefused] = useState(false);
  const [sources, setSources] = useState<Map<number, TogetherSource>>(new Map());
  const [code, setCode] = useState<Set<number>>(new Set());
  const [latest, setLatest] = useState<LatestLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<CombinePicks>({});
  // The checkboxes show only once the viewer asks to choose (or something is still checked).
  const [picking, setPicking] = useState(false);
  const choosing = picking || selected.length > 0;

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<RowsDetail>).detail;
      setRows(d);
      setSlots(readSlots());
      setSelected((s) => keepListed(s, d.listed.map((r) => r.number)));
    };
    document.addEventListener(ROWS_EVENT, on);
    return () => document.removeEventListener(ROWS_EVENT, on);
  }, []);

  // One primary per view: while something is checked, the selection's action is it, so the opener's goes.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-together', selected.length > 0 && rows.show);
  }, [selected.length, rows.show]);

  // The rows make room for their checkbox only while choosing (changes.css [data-picking]).
  useEffect(() => {
    document.getElementById('cg-table')?.toggleAttribute('data-picking', choosing && rows.show);
  }, [choosing, rows.show]);

  // "Choose changes" moves focus to the first checkbox, where the next step is.
  const [focusFirst, setFocusFirst] = useState(false);
  useEffect(() => {
    if (!focusFirst || !choosing) return;
    setFocusFirst(false);
    document.querySelector<HTMLElement>('[data-together-slot] [role="checkbox"], [data-together-slot] input')?.focus();
  }, [focusFirst, choosing, slots]);

  const byNumber = useMemo(() => new Map(rows.listed.map((r) => [r.number, r])), [rows.listed]);

  // Read what a checked change brings (once per version); a code change leaves the selection and says why.
  useEffect(() => {
    const todo = selected.filter((n) => !sources.has(n));
    if (!todo.length) return;
    let live = true;
    (async () => {
      try {
        const lib = latest ?? (await readLatestLibrary());
        if (!live) return;
        if (!latest) setLatest(lib);
        const read = await Promise.all(todo.map((n) => readTogetherSource({ number: n, title: byNumber.get(n)?.title ?? `#${n}`, head: { sha: byNumber.get(n)?.sha ?? '' } }, lib.tokensRoot)));
        if (!live) return;
        setSources((m) => new Map([...m, ...read.map((s) => [s.number, s] as const)]));
        const codeOnes = read.filter((s) => !s.tokens).map((s) => s.number);
        if (codeOnes.length) {
          setCode((c) => new Set([...c, ...codeOnes]));
          setSelected((s) => s.filter((n) => !codeOnes.includes(n)));
        }
        setError(null);
      } catch (err) {
        if (live) setError(failure(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [selected, sources, latest, byNumber, failure]);

  const ready = selected.length >= MIN_TOGETHER && selected.every((n) => sources.get(n)?.tokens) && latest;
  const combo = useMemo(() => {
    if (!ready || !latest) return null;
    const edits = selected.map((n) => sources.get(n)!.edits!);
    const c = combineChanges(latest.files, edits, picks);
    const titles = new Map(selected.map((n) => [n, sources.get(n)!.title]));
    const conflictRows = c.conflicts.length ? togetherRows(c.conflicts, { latest: latest.files, options: latest.options, titles }) : [];
    // The guardrail counts on the combination itself, once every token has a value.
    const guard = c.missing.length ? null : togetherGuardrail(reviewTokenChange(latest.files, c.files, latest.pairs, latest.options));
    return { c, conflictRows, guard };
  }, [ready, latest, selected, sources, picks]);

  if (!rows.show || rows.listed.length < MIN_TOGETHER) return null;

  const toggle = (n: number, on: boolean) => {
    const t = toggleChange(selected, n, on);
    setRefused(t.refused === 'full');
    setSelected(t.selected);
    if (on) setCode((c) => (c.has(n) ? new Set([...c].filter((x) => x !== n)) : c));
  };

  const line = error ?? (combo ? combineSummary({ changes: selected.length, tokens: combo.c.tokens, conflicts: combo.c.conflicts.length, missing: combo.c.missing.length }) : selected.length >= MIN_TOGETHER ? `Reading ${selected.length} changes.` : selectionLine(selected.length, refused));
  const open = Boolean(combo && !combo.c.missing.length && !combo.c.problems.length);
  // Only the picks of conflicts this selection has travel with it.
  const active: CombinePicks = Object.fromEntries(Object.entries(picks).filter(([k]) => combo?.c.conflicts.some((c) => c.key === k)));
  const use = encodePicks(active);
  const n = selected.length;

  /** One choice: the change as the card title, the value it keeps under it. */
  const optionValue = (v: { alias: string | null; css: string | null; hex: string | null } | null) =>
    v ? <TokenValue value={v.alias ? `{${v.alias}}` : (v.css ?? '')} resolved={v.alias ? (v.css ?? undefined) : undefined} swatch={v.hex ?? false} /> : 'Removes the token';

  return (
    <>
      {slots.map((s) => {
        const row = byNumber.get(s.number);
        if (!row || !choosing) return null;
        return (
          <span key={s.number}>
            {createPortal(
              <Checkbox
                className="cg-pick-box"
                label={<VisuallyHidden>Try {viewTitle(row.title)} with other changes</VisuallyHidden>}
                checked={selected.includes(s.number)}
                onCheckedChange={(on) => toggle(s.number, on)}
              />,
              s.box,
            )}
            {s.note && code.has(s.number)
              ? createPortal(
                  <>
                    {CODE_LINE}{' '}
                    <Link href={`?pr=${s.number}`} data-open-pr={s.number}>
                      {ALONE_LABEL}
                    </Link>
                  </>,
                  s.note,
                )
              : null}
          </span>
        );
      })}
      {/* One region: the sentence and the actions on one line, then what the sentence asks for (picks), then the
          guardrail. On a phone the actions come last, under what unlocks them. */}
      <div className="cg-together-grid" data-actions>
        <p className={n >= MIN_TOGETHER || error ? 'cg-together-line' : 'cg-together-line is-muted'} aria-live="polite">
          {choosing ? line : INTRO_LINE}
        </p>
        {!choosing ? (
          <div className="cg-together-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setPicking(true);
                setFocusFirst(true);
              }}
            >
              {CHOOSE_LABEL}
            </Button>
          </div>
        ) : n < MIN_TOGETHER ? (
          <div className="cg-together-actions">
            <Button
              variant="ghost"
              onClick={() => {
                setSelected([]);
                setRefused(false);
                setPicking(false);
              }}
            >
              {CANCEL_LABEL}
            </Button>
          </div>
        ) : (
          <div className="cg-together-actions">
            <Button variant="secondary" disabled={!open} onClick={() => (location.href = viewTogetherHref(selected, use))}>
              {VIEW_LABEL}
            </Button>
            {admin ? (
              <Button variant="primary" disabled={!open} onClick={() => window.open(tryTogetherUrl(admin, selected, active), '_blank', 'noopener')}>
                {tryLabel(n)}
                <VisuallyHidden> (opens the demo admin in a new tab)</VisuallyHidden>
              </Button>
            ) : null}
          </div>
        )}
        {combo && combo.conflictRows.length ? (
          <ul className="lib-rows cg-together-rows" aria-label="Tokens these changes set differently">
            {combo.conflictRows.map((r) => (
              <li className="lib-row" key={r.key}>
                <div className="lib-token">
                  <span className="lib-name mono">{r.name}</span>
                  {r.context ? <span className="lib-meta">{r.context} only</span> : null}
                </div>
                <ChoiceCardGroup
                  label={`Value of ${r.name}${r.context ? ` in ${r.context}` : ''}`}
                  hideLabel
                  value={picks[r.key] ? String(picks[r.key]) : ''}
                  onValueChange={(v) => setPicks((p) => ({ ...p, [r.key]: Number(v) }))}
                >
                  {r.options.map((o) => (
                    <ChoiceCard key={o.change} value={String(o.change)} title={o.label} description={optionValue(o.value)} />
                  ))}
                </ChoiceCardGroup>
              </li>
            ))}
          </ul>
        ) : null}
        {combo?.guard ? (
          <Alert tone={combo.guard.ok ? 'success' : 'warning'} announce="off" className="cg-together-guard" title={combo.guard.sentence}>
            {combo.guard.failing.length ? (
              <ul className="lib-fails">
                {combo.guard.failing.map((f) => (
                  <li key={`${f.pair}|${f.where}`}>
                    <span className="mono">{f.pair}</span>, {f.where}: {f.ratio}, needs {f.min}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        {combo?.c.problems.length ? (
          <Alert tone="warning" announce="off" className="cg-together-guard" title="These changes cannot be combined here">
            {combo.c.problems[0]}. Open each change to see its files.
          </Alert>
        ) : null}
      </div>
    </>
  );
}

let mounted = false;

/** Mounts the selection once, into the end of the list's card. */
export function mountCombineChanges(el: HTMLElement, props: CombineChangesProps) {
  if (mounted) return;
  mounted = true;
  createRoot(el).render(<CombineChanges {...props} />);
}
