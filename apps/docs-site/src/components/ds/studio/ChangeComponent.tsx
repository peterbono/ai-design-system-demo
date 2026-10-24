// "Change this component" in a team's Components drawer (TeamComponents.tsx), the same three paths as Bridge's own
// drawer (scripts/request-form.ts), for a team whose developers build from build requests (docs/BUILD-REQUESTS.md):
//   - Adjust the look: the team's token editor, filtered to this component's tokens (?component=<slug>).
//   - Add a variant or option (a variant, an option or a layout) and Something looks wrong: one short form that files a
//     build request (scripts/build-request-send.ts, @bridge-ds/core createBuildRequestOnGitHub), then says where she
//     follows it (Being built).
// The step opens in place under the preview: what she wants to change (one DS RadioGroup), then the form. The drawer
// footer keeps one primary action: "Change this component", then the step's own action (Edit its tokens, Send) next to
// Cancel. A GitHub member writes with their token; an email member through Bridge's server (/api/contribute); signed
// out, the action opens the sign-in dialog. On the sample team, the send opens the sample-team dialog (data-demo-write).
// Words and rules: lib/change-intent.ts.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button, Input, Link, Radio, RadioGroup, Select, Textarea } from '@bridge-ds/react';
import type { IntegrationsConfig } from '@bridge-ds/core';
import ButtonLink from '../ButtonLink';
import {
  buildFormCopy,
  buildFormProblems,
  buildModeFor,
  buildSentLines,
  isChangeIntent,
  isStructureKind,
  STRUCTURE_KINDS,
  teamBuildRequest,
  teamIntentOptions,
  type BuildFormMode,
  type ChangeIntent,
  type StructureKind,
} from '../../../lib/change-intent';
import { figmaFromLink, figmaLinkProblem } from '../../../lib/request-attachments';
import { ghAction } from '../../../lib/gh-wording';
import { studioHref } from '../../../lib/team-path';

/** Where the change step stands; owned by the drawer so its footer and body agree. */
export interface ChangeFlow {
  open: boolean;
  intent: ChangeIntent | null;
  busy: boolean;
  /** Sent: the number Being built shows, and which form sent it. */
  sent: { n: number; mode: BuildFormMode } | null;
}

export const CLOSED_FLOW: ChangeFlow = { open: false, intent: null, busy: false, sent: null };

interface Row {
  field: string;
  before: string;
  after: string;
}
const EMPTY_ROW: Row = { field: '', before: '', after: '' };

/** Signed in on this team (GitHub or email member), read from the shared session, again on every sign-in change. */
function useConnected(): { connected: boolean; signIn: boolean; sample: boolean } {
  const [state, setState] = useState({ connected: false, signIn: true, sample: false });
  useEffect(() => {
    let live = true;
    const sync = () =>
      void Promise.all([import('../../../scripts/github-session'), import('../../../scripts/demo-gate')]).then(([s, d]) => {
        if (live) setState({ connected: Boolean(s.hasWorkingToken() && s.currentViewer()), signIn: s.prefersSignIn(), sample: d.sampleVisitor() });
      });
    sync();
    document.addEventListener('bridge:auth', sync);
    return () => {
      live = false;
      document.removeEventListener('bridge:auth', sync);
    };
  }, []);
  return state;
}

export interface ChangeStepProps {
  /** The component's coded name ("Button") and its slug. */
  component: string;
  slug: string;
  /** It paints with tokens: "Adjust the look" can be picked. */
  hasTokens: boolean;
  /** "owner/name" of the team. */
  repo: string;
  integrations?: IntegrationsConfig | undefined;
  /** The component's page in the team's Library, written in the request for developers. */
  componentUrl?: string | undefined;
  flow: ChangeFlow;
  setFlow: (f: ChangeFlow | ((f: ChangeFlow) => ChangeFlow)) => void;
  /** The id the footer's send button points at (`form`). */
  formId: string;
}

/** The step in the drawer body: the question, then the form of the picked path, or what was sent. */
export function ChangeStep({ component, slug, hasTokens, repo, integrations, componentUrl, flow, setFlow, formId }: ChangeStepProps) {
  const headingId = useId();
  const boxRef = useRef<HTMLElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<StructureKind>('new-variant');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [figma, setFigma] = useState('');
  const [rows, setRows] = useState<Row[]>([EMPTY_ROW]);
  const [problems, setProblems] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const mode = flow.intent ? buildModeFor(flow.intent) : null;
  const copy = mode ? buildFormCopy(mode, component) : null;

  // A new component, or the step closed: start empty.
  useEffect(() => {
    setKind('new-variant');
    setTitle('');
    setSummary('');
    setFigma('');
    setRows([EMPTY_ROW]);
    setProblems([]);
    setFailed(null);
  }, [slug, flow.open]);

  // Opened: the question takes the focus and comes into view (the drawer body scrolls).
  useEffect(() => {
    if (!flow.open) return;
    const box = boxRef.current;
    box?.scrollIntoView({ block: 'start' });
    requestAnimationFrame(() => box?.querySelector<HTMLElement>('[role="radio"]:not([aria-disabled="true"]):not([data-disabled])')?.focus());
  }, [flow.open]);

  // A path picked: its form comes into view under the question (the radio keeps the focus).
  useEffect(() => {
    if (!flow.intent) return;
    requestAnimationFrame(() => boxRef.current?.querySelector('form')?.scrollIntoView({ block: 'nearest' }));
  }, [flow.intent]);

  useEffect(() => {
    // The send button left with the form: the focus goes to what was sent, once the drawer settled its own focus.
    if (!flow.sent) return;
    const t = window.setTimeout(() => doneRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [flow.sent]);

  if (flow.sent) {
    const s = buildSentLines(flow.sent.mode, flow.sent.n);
    return (
      <div className="tcm-chg-done" role="status" tabIndex={-1} ref={doneRef}>
        <p>
          <strong>{s.lead}</strong> {s.next}
        </p>
        <p>
          <Link href={studioHref(`building/?request=${flow.sent.n}`)}>{s.link}</Link>
        </p>
      </div>
    );
  }
  if (!flow.open) return null;

  const blocked = (f: string) => problems.some((p) => p === f);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mode || !copy || flow.busy) return;
    const linkProblem = figmaLinkProblem(figma);
    const found = [...buildFormProblems(mode, { title, summary, figma }), ...(linkProblem ? [linkProblem] : [])];
    setProblems(found);
    setFailed(null);
    if (found.length) {
      requestAnimationFrame(() => boxRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const [{ sendBuildRequest }, session] = await Promise.all([import('../../../scripts/build-request-send'), import('../../../scripts/github-session')]);
    const login = session.signedInWithGitHub() ? (session.currentViewer()?.login ?? null) : null;
    const input = teamBuildRequest(component, mode, { kind, title, summary, changes: rows, figma: figmaFromLink(figma) }, login);
    setFlow((f) => ({ ...f, busy: true }));
    try {
      const out = await sendBuildRequest(repo, input, { integrations, componentUrl });
      setFlow({ open: false, intent: null, busy: false, sent: { n: out.ref.number, mode } });
    } catch (err) {
      setFlow((f) => ({ ...f, busy: false }));
      const auth = session.ghAuthFailure(err, 'send it');
      // GitHub's own words only for someone signed in with GitHub (lib/vocabulary: designers never read them).
      const said = login && err instanceof Error && err.message ? ` GitHub said: ${err.message}` : '';
      setFailed(auth ? auth.text : `It was not sent. Your text stays here: try again in a moment.${said}`);
    }
  };

  const titleProblem = copy && blocked(copy.missing.title) ? copy.missing.title : undefined;
  const summaryProblem = copy && blocked(copy.missing.summary) ? copy.missing.summary : undefined;
  const linkProblem = figmaLinkProblem(figma);
  const figmaProblem = copy && (blocked(copy.missing.figma) ? copy.missing.figma : linkProblem && blocked(linkProblem) ? linkProblem : undefined);

  return (
    <section className="tcm-chg" aria-labelledby={headingId} ref={boxRef}>
      <h3 id={headingId} className="tcm-chg-h">
        Change {component}
      </h3>
      <RadioGroup
        label="What do you want to change?"
        name={`change-intent-${slug}`}
        value={flow.intent ?? ''}
        onValueChange={(v) => {
          if (!isChangeIntent(v)) return;
          setProblems([]);
          setFailed(null);
          setFlow((f) => ({ ...f, intent: v }));
        }}
      >
        {teamIntentOptions(hasTokens).map((o) => (
          <Radio key={o.value} value={o.value} label={o.label} description={o.line} disabled={o.disabled} />
        ))}
      </RadioGroup>
      {mode && copy && (
        <form id={formId} className="tcm-chg-form" noValidate onSubmit={(e) => void submit(e)} aria-label={copy.heading}>
          {copy.kind && (
            <Select
              label="What kind of change"
              value={kind}
              onValueChange={(v) => isStructureKind(v) && setKind(v)}
              options={STRUCTURE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
            />
          )}
          <Input label={copy.title.label} name="title" autoComplete="off" placeholder={copy.title.placeholder} required value={title} onValueChange={setTitle} error={titleProblem} aria-invalid={titleProblem ? true : undefined} />
          <Textarea label={copy.summary.label} name="summary" rows={3} placeholder={copy.summary.placeholder} required value={summary} onValueChange={setSummary} error={summaryProblem} aria-invalid={summaryProblem ? true : undefined} />
          <Input
            label={copy.figma.label}
            name="figma"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://www.figma.com/design/..."
            hint="In Figma, right-click the frame, then Copy link to selection."
            required={copy.figma.required}
            value={figma}
            onValueChange={setFigma}
            error={figmaProblem}
            aria-invalid={figmaProblem ? true : undefined}
          />
          {copy.changes && (
            <fieldset className="tcm-chg-rows">
              <legend>What differs (optional)</legend>
              {rows.map((r, i) => (
                <div className="tcm-chg-row" key={i}>
                  <Input size="sm" aria-label="What differs" placeholder="What: radius" autoComplete="off" value={r.field} onValueChange={(v) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, field: v } : x)))} />
                  <Input size="sm" aria-label="Now" placeholder="Now: 12" autoComplete="off" value={r.before} onValueChange={(v) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, before: v } : x)))} />
                  <Input size="sm" aria-label="In Figma" placeholder="In Figma: 6" autoComplete="off" value={r.after} onValueChange={(v) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, after: v } : x)))} />
                </div>
              ))}
              <Button variant="ghost" size="sm" type="button" iconStart={Plus} onClick={() => setRows((xs) => [...xs, EMPTY_ROW])}>
                Add a row
              </Button>
            </fieldset>
          )}
          {failed && (
            <p className="tcm-chg-error" role="alert">
              {failed}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export interface ChangeFooterProps {
  component: string;
  slug: string;
  hasTokens: boolean;
  flow: ChangeFlow;
  setFlow: (f: ChangeFlow | ((f: ChangeFlow) => ChangeFlow)) => void;
  formId: string;
  /** The drawer's other actions (Open in Storybook, More), shown while the step is closed. */
  rest?: React.ReactNode;
}

/** The drawer footer: "Change this component" (the one primary), or the step's action next to Cancel. */
export function ChangeFooter({ component, slug, hasTokens, flow, setFlow, formId, rest }: ChangeFooterProps) {
  const { connected, signIn, sample } = useConnected();
  const openerRef = useRef<HTMLButtonElement>(null);
  const reopen = useRef(false);
  useEffect(() => {
    if (!flow.open && reopen.current) {
      reopen.current = false;
      openerRef.current?.focus();
    }
  }, [flow.open]);
  if (!flow.open)
    return (
      <>
        <Button ref={openerRef} variant="primary" iconStart={Pencil} aria-expanded="false" onClick={() => setFlow({ ...CLOSED_FLOW, open: true })}>
          Change this component
        </Button>
        {rest}
      </>
    );
  const cancel = (
    <Button
      variant="ghost"
      onClick={() => {
        reopen.current = true;
        setFlow(CLOSED_FLOW);
      }}
    >
      Cancel
    </Button>
  );
  const mode = flow.intent ? buildModeFor(flow.intent) : null;
  const look = flow.intent === 'look' && hasTokens;
  const copy = mode ? buildFormCopy(mode, component) : null;
  return (
    <>
      {cancel}
      {look && (
        <ButtonLink variant="primary" iconStart={Pencil} href={studioHref(`tokens/?component=${encodeURIComponent(slug)}`)}>
          {`Edit ${component} tokens`}
        </ButtonLink>
      )}
      {copy &&
        (connected || sample ? (
          <Button variant="primary" type="submit" form={formId} loading={flow.busy} data-demo-write="send a build request">
            {flow.busy ? copy.busy : copy.submit}
          </Button>
        ) : (
          <Button variant="primary" data-gh-open="" data-demo-write="send a build request">
            {ghAction('send it', signIn)}
          </Button>
        ))}
    </>
  );
}
