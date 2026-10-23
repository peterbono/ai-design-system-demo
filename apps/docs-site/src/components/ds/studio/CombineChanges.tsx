// Preview token branches together, on Branches (components/ds/studio/BranchesList): the floating bar at the bottom
// centre that shows while at least one token branch is checked (DS inverse surface). One checked: "Try it alone"
// (the admin demo with the Bridge toolbar on that branch). Two to four: "Preview together", the view's primary while
// something is checked. The combination is computed here, in the browser, from the branches' own token edits on top
// of the latest library (@bridge-ds/core token-combine). When two branches set a token differently, or the contrast
// checks fail on the combination, "Preview together" opens a DS Dialog first: one row per token to pick whose value
// to use (the rows of Update from main) and the contrast guardrail, then the two ways to open it. Rules and words:
// lib/combine-changes.ts and lib/branches-page.ts. Reads: scripts/combine-read.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, ChoiceCard, ChoiceCardGroup, Dialog, DialogClose, DialogContent, TokenValue, VisuallyHidden } from '@bridge-ds/react';
import { combineChanges, encodePicks, type CombinePicks } from '@bridge-ds/core';
import { combineSummary, MAX_TOGETHER, MIN_TOGETHER, namesOf, togetherGuardrail, togetherRows, tryTogetherUrl, VIEW_LABEL } from '../../../lib/combine-changes';
import { barCopy, FULL_TIP } from '../../../lib/branches-page';
import { reviewTokenChange } from '../../../lib/token-review';
import { viewTitle, viewTogetherHref } from '../../../lib/view-scope';
import { START_CHANGE_EVENT, type StartChangeLook } from './StartChange';
import { LatestLibraryError, readLatestLibrary, readTogetherSource, type LatestLibrary, type TogetherSource } from '../../../scripts/combine-read';

export interface ListedBranch {
  number: number;
  title: string;
  sha: string;
}

export interface SelectionBarProps {
  selected: number[];
  /** The checkable branches on screen, by number. */
  listed: Map<number, ListedBranch>;
  /** Production admin (bridge.config.json previews.production.admin): where previews open. */
  admin: string | null;
  /** Reads failed: the sentence that says how to fix it. */
  failure: (err: unknown) => string;
  onClear: () => void;
  /** A checked branch turned out to change code: it leaves the selection. */
  onDrop: (numbers: number[]) => void;
}

const openTab = (href: string) => window.open(href, '_blank', 'noopener');

export function SelectionBar({ selected, listed, admin, failure, onClear, onDrop }: SelectionBarProps) {
  const [sources, setSources] = useState<Map<number, TogetherSource>>(new Map());
  const [latest, setLatest] = useState<LatestLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string | null>(null);
  const [picks, setPicks] = useState<CombinePicks>({});
  const [asking, setAsking] = useState(false);
  const n = selected.length;
  const copy = barCopy(n);

  // One primary per view: while something is checked, the bar's action is it and Create branch steps down to secondary.
  // Only a change of selection speaks: the page sets the button for its view (scripts/changes.ts).
  const had = useRef(false);
  useEffect(() => {
    if (!n && !had.current) return;
    had.current = n > 0;
    document.dispatchEvent(new CustomEvent<StartChangeLook>(START_CHANGE_EVENT, { detail: { variant: n > 0 ? 'secondary' : 'primary', hidden: false } }));
  }, [n]);

  // Read what each checked branch brings, once per version; a code branch leaves the selection and the bar says why.
  useEffect(() => {
    const todo = selected.filter((x) => !sources.has(x));
    if (n < MIN_TOGETHER || !todo.length) return;
    let live = true;
    (async () => {
      try {
        const lib = latest ?? (await readLatestLibrary());
        if (!live) return;
        if (!latest) setLatest(lib);
        const read = await Promise.all(todo.map((x) => readTogetherSource({ number: x, title: listed.get(x)?.title ?? `#${x}`, head: { sha: listed.get(x)?.sha ?? '' } }, lib.tokensRoot)));
        if (!live) return;
        setSources((m) => new Map([...m, ...read.map((s) => [s.number, s] as const)]));
        const code = read.filter((s) => !s.tokens);
        if (code.length) {
          setDropped(`${namesOf(code)} ${code.length === 1 ? 'changes' : 'change'} code, so ${code.length === 1 ? 'it' : 'they'} can't be previewed with others.`);
          onDrop(code.map((s) => s.number));
        }
        setError(null);
      } catch (err) {
        if (live) setError(err instanceof LatestLibraryError ? err.message : failure(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [selected, sources, latest, listed, failure, onDrop, n]);

  const ready = n >= MIN_TOGETHER && selected.every((x) => sources.get(x)?.tokens) && latest;
  const combo = useMemo(() => {
    if (!ready || !latest) return null;
    const c = combineChanges(
      latest.files,
      selected.map((x) => sources.get(x)!.edits!),
      picks,
    );
    const titles = new Map(selected.map((x) => [x, sources.get(x)!.title]));
    const conflictRows = c.conflicts.length ? togetherRows(c.conflicts, { latest: latest.files, options: latest.options, titles }) : [];
    const guard = c.missing.length ? null : togetherGuardrail(reviewTokenChange(latest.files, c.files, latest.pairs, latest.options));
    return { c, conflictRows, guard };
  }, [ready, latest, selected, sources, picks]);

  if (!copy) return null;

  const active: CombinePicks = Object.fromEntries(Object.entries(picks).filter(([k]) => combo?.c.conflicts.some((c) => c.key === k)));
  const opens = Boolean(combo && !combo.c.missing.length && !combo.c.problems.length);
  const needsAsk = Boolean(combo && (combo.c.conflicts.length || combo.c.problems.length || (combo.guard && !combo.guard.ok)));
  const goTogether = () => (admin ? openTab(tryTogetherUrl(admin, selected, active)) : (location.href = viewTogetherHref(selected, encodePicks(active))));
  const alone = () => {
    const only = selected[0]!;
    if (admin) openTab(tryTogetherUrl(admin, [only], {}));
    else location.href = `?pr=${only}`;
  };
  const together = () => {
    if (!combo) return;
    if (needsAsk) setAsking(true);
    else goTogether();
  };
  const clear = () => {
    setDropped(null);
    setPicks({});
    onClear();
  };

  // The second line: what went wrong, else the hint of a single pick, else the full rule once 4 are checked.
  const second = error ?? dropped ?? copy.hint ?? (n >= MAX_TOGETHER ? FULL_TIP : null);
  const optionValue = (v: { alias: string | null; css: string | null; hex: string | null } | null) =>
    v ? <TokenValue value={v.alias ? `{${v.alias}}` : (v.css ?? '')} resolved={v.alias ? (v.css ?? undefined) : undefined} swatch={v.hex ?? false} /> : 'Removes the token';

  return (
    <>
      <div className="cg-bar" role="region" aria-label="Selected branches">
        <p className="cg-bar-text" aria-live="polite">
          <span className="cg-bar-title">{copy.title}</span>
          {second && <span className="cg-bar-hint">{second}</span>}
        </p>
        <span className="cg-bar-actions">
          <Button variant="ghost" className="cg-bar-clear" onClick={clear}>
            Clear
          </Button>
          {copy.action === 'alone' ? (
            <Button variant="secondary" className="cg-bar-alone" onClick={alone}>
              {copy.label}
              {admin && <VisuallyHidden> (opens the demo admin in a new tab)</VisuallyHidden>}
            </Button>
          ) : (
            <Button variant="inverse" className="cg-bar-go" loading={!combo && !error} disabled={!combo} onClick={together}>
              {copy.label}
              {admin && !needsAsk && <VisuallyHidden> (opens the demo admin in a new tab)</VisuallyHidden>}
            </Button>
          )}
        </span>
      </div>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent
          size="lg"
          title={`Preview ${n} branches together`}
          description={combo ? combineSummary({ changes: n, tokens: combo.c.tokens, conflicts: combo.c.conflicts.length, missing: combo.c.missing.length }) : undefined}
          footer={
            <ButtonGroup align="end">
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              {admin && (
                <Button variant="secondary" disabled={!opens} onClick={() => (location.href = viewTogetherHref(selected, encodePicks(active)))}>
                  {VIEW_LABEL}
                </Button>
              )}
              <Button
                variant="primary"
                disabled={!opens}
                onClick={() => {
                  setAsking(false);
                  goTogether();
                }}
              >
                {admin ? 'Open in the demo admin' : VIEW_LABEL}
              </Button>
            </ButtonGroup>
          }
        >
          {combo && combo.conflictRows.length ? (
            <ul className="lib-rows cg-together-rows" aria-label="Tokens these branches set differently">
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
            <Alert tone="warning" announce="off" className="cg-together-guard" title="These branches cannot be combined here">
              {combo.c.problems[0]}. Open each branch to see what it changes: {selected.map((x) => viewTitle(listed.get(x)?.title ?? `#${x}`)).join(', ')}.
            </Alert>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
