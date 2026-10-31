// "Start an exploration" (VOCAB.startExploration): the one way to start work in Studio, on the Changes header and the
// Studio home (rules and words: lib/create-branch.ts). A DS Dialog, one question: "What do you want to explore?"
//   - Where: a product, or the library itself (Tokens, variants, new components). A change to the library is an
//     exploration whose target is the library. Preselected from ?product= (key, name, or "library"), else the only
//     product, else the library when the team lists no product.
//   - What it is, in one sentence, and a Jira ticket on demand. "Start with Claude AI" starts it the way the CLI and
//     MCP server do (the core exploration start with the product label from productMarks, none for the library),
//     then says what to tell Claude and opens the exploration. A product with its own repository (bridge.config.json
//     products[].repo) gets the branch there, so developers keep their environment and the library comes from npm.
//     When Bridge cannot reach that repository, nothing starts: one warning in designer words, "Ask an admin to
//     connect <product>" (copies a message) and, only if the person picks it, "Start in the library instead".
//   - A quiet "Something looks wrong? Report it" in the footer: the component, then its Components drawer on
//     "Something looks wrong" (lib/overview-board startChangeHref).
// Old addresses open it too: ?start= on the Changes page (start=new, the old "New component", picks the library).
// The page decides the trigger's weight (`bridge:start-change`): the primary when nothing needs the viewer, secondary
// when the first need is the primary, hidden signed out (Connect GitHub takes its place).
import { VOCAB } from '../../../lib/vocabulary';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Plus } from 'lucide-react';
import { parseJiraKey, productMarks, productsOf, type ProductConfig } from '@bridge-ds/core';
import { Alert, Button, CodeBlock, Combobox, Dialog, DialogContent, DialogTrigger, Input, Select } from '@bridge-ds/react';
import { startChangeHref } from '../../../lib/overview-board';
import {
  askAdmin,
  claudePrompt,
  featureHref,
  featureName,
  featurePurpose,
  featureProblems,
  featureRepo,
  initialTarget,
  productParam,
  productRepoBlockedLine,
  startTargets,
} from '../../../lib/create-branch';
import { installUrl } from '../../../lib/access-view';
import { siteConfig } from '../../../scripts/repo-context';
import { useCopy } from './TeamLink';

export interface StartExplorationProps {
  components: { name: string; slug: string; family?: string }[];
  /**
   * `menu`: the page header's action (the Changes page), its weight set by the page.
   * `card`: the dashed first card of the home's explorations, always shown (the page only mounts it signed in).
   * `button`: a lone secondary button (the home's explorations when there are none yet).
   * `choice`: the title of a way-to-start card (the home with nothing at all), the card's primary action.
   */
  appearance?: 'menu' | 'card' | 'button' | 'choice';
}

export const START_CHANGE_EVENT = 'bridge:start-change';
/** Sent when the dialog opens or closes, so the page keeps one primary action (the dialog's). */
export const PICKER_EVENT = 'bridge:start-change-picker';

export interface StartChangeLook {
  variant: 'primary' | 'secondary';
  hidden: boolean;
}

type Step = 'start' | 'report' | 'done';

/**
 * An old address that opened the start: ?start= (any value) on the page with the header action. "new" (the old
 * "New component") picks the library. Null when the address asks for nothing.
 */
export function startFromAddress(search: string): { target: string | null } | null {
  const p = new URLSearchParams(search);
  const start = p.get('start');
  if (start === null || p.get('for')) return null;
  return { target: start === 'new' || start === 'library' ? 'library' : productParam(search) };
}

function pageLook(): StartChangeLook {
  const d = document.querySelector<HTMLElement>('[data-greet]')?.dataset;
  return { variant: d?.startVariant === 'secondary' ? 'secondary' : 'primary', hidden: d?.startHidden === 'true' };
}

/** The repository's products (bridge.config.json, via repo-context siteConfig), else the defaults. */
function pageProducts(): ProductConfig[] {
  try {
    return productsOf(siteConfig() as { products?: ProductConfig[] });
  } catch {
    return productsOf(null);
  }
}

export default function StartExploration({ components, appearance = 'menu' }: StartExplorationProps) {
  // The server render and the first client render agree; the page's choice comes in right after.
  const [look, setLook] = useState<StartChangeLook>({ variant: 'primary', hidden: false });
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<ProductConfig[]>([]);
  const [step, setStep] = useState<Step>('start');
  const [slug, setSlug] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [sentence, setSentence] = useState('');
  const [jira, setJira] = useState('');
  const [jiraOpen, setJiraOpen] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The product's own repository is out of Bridge's reach: the admin action, and the library fallback on request.
  const [blocked, setBlocked] = useState<{ product: string; repo: string; reason: 'not-connected' | 'read-only' } | null>(null);
  const { copied, said, copy } = useCopy(3000);
  const [done, setDone] = useState<{ prompt: string; href: string; name: string; where: string } | null>(null);
  const sentenceRef = useRef<HTMLInputElement>(null);
  const jiraRef = useRef<HTMLInputElement>(null);

  const targets = startTargets(products);
  const picked = targets.find((t) => t.value === target) ?? null;

  const reset = (all: ProductConfig[], fromPage: string | null) => {
    setStep('start');
    setSlug(null);
    setTarget(initialTarget(startTargets(all), fromPage));
    setSentence('');
    setJira('');
    setJiraOpen(false);
    setTried(false);
    setBusy(false);
    setError(null);
    setBlocked(null);
    setDone(null);
  };

  useEffect(() => {
    const on = (e: Event) => setLook((e as CustomEvent<StartChangeLook>).detail);
    document.addEventListener(START_CHANGE_EVENT, on);
    setLook(pageLook());
    const all = pageProducts();
    setProducts(all);
    // An old address that opened the start (the page header's action only, so it opens once per page).
    const asked = appearance === 'menu' ? startFromAddress(location.search) : null;
    if (asked) {
      reset(all, asked.target);
      setOpen(true);
      const url = new URL(location.href);
      url.searchParams.delete('start');
      if (url.searchParams.get('view') === 'explorations') url.searchParams.delete('view');
      history.replaceState(history.state, '', url);
    }
    return () => document.removeEventListener(START_CHANGE_EVENT, on);
  }, []);

  useEffect(() => {
    document.dispatchEvent(new CustomEvent(PICKER_EVENT, { detail: { open } }));
  }, [open]);

  const onOpenChange = (next: boolean) => {
    if (busy) return;
    if (next) reset(products, productParam(location.search));
    setOpen(next);
  };

  const go = (href: string) => {
    location.href = href;
  };

  const problems = featureProblems({ product: target, sentence, jira }, targets);
  const shown = tried ? problems : {};

  /** `inLibrary`: the person chose the fallback, the design system repository, after the product one was out of reach. */
  async function start(inLibrary = false) {
    setTried(true);
    setError(null);
    if (Object.keys(problems).length) {
      if (problems.sentence) sentenceRef.current?.focus();
      else if (problems.jira) jiraRef.current?.focus();
      return;
    }
    const t = picked!;
    const session = await import('../../../scripts/github-session');
    if (!session.hasWorkingToken()) {
      const { ghAction } = await import('../../../lib/gh-wording');
      setError(`${ghAction('start it here', session.prefersSignIn())}.`);
      return;
    }
    setBusy(true);
    try {
      const { explorationsConfig, startInProductRepo, startLinkedExploration } = await import('../../../scripts/exploration-start');
      const key = parseJiraKey(jira);
      const author = session.currentViewer()?.login;
      const name = featureName(sentence);
      const cfg = explorationsConfig();
      const e = { name, purpose: featurePurpose(sentence), useCase: 'terminal' as const, ...(author ? { author } : {}), ...(key ? { jira: key } : {}) };
      const labels = productMarks(products, t.product).labels;
      const repo = inLibrary || t.library ? null : featureRepo(t.product, `${cfg.owner}/${cfg.repo}`);
      const r = repo
        ? await startInProductRepo(repo, e, labels, { name: t.product.name, library: `${cfg.owner}/${cfg.repo}`, ...(t.product.preview ? { preview: t.product.preview } : {}) })
        : await startLinkedExploration(cfg, e, null, labels);
      if ('blocked' in r) {
        setBlocked({ product: t.product.name, repo: repo!, reason: r.blocked });
        return;
      }
      setBlocked(null);
      const { started } = r;
      setDone({
        prompt: claudePrompt({ sentence, product: t.product, number: started.pr, library: t.library }),
        href: featureHref(started.pr),
        name,
        where: t.library ? VOCAB.main : t.product.name,
      });
      setStep('done');
    } catch (err) {
      const msg = (err as Error).message || 'GitHub did not answer.';
      // Suggest mode, or waiting for Bridge Direct's OK: the sentence already says what to do.
      const plain = (err as Error).name === 'SuggestOnlyError' || session.isDirectWait(err);
      setError(plain ? msg : `${msg.replace(/\.?$/, '.')} Try again, or rename it if one with this name already exists.`);
    } finally {
      setBusy(false);
    }
  }

  const footer = (left: ReactNode, right: ReactNode) => (
    <div className="sc-foot">
      <span className="sc-foot-left">{left}</span>
      {/* Keyed per step: a click on one step's button never lands on the next step's (a submit in the same place). */}
      <span className="sc-foot-main" key={step}>
        {right}
      </span>
    </div>
  );

  let title: ReactNode;
  let body: ReactNode;
  let foot: ReactNode;
  if (step === 'start') {
    title = 'What do you want to explore?';
    body = (
      <form
        className="sc-form"
        id="sc-start"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <Select
          label="Where"
          placeholder="Pick a product or the library"
          size="lg"
          options={targets.map((t) => ({ value: t.value, label: t.label, ...(t.description ? { description: t.description } : {}) }))}
          value={target}
          onValueChange={(v) => {
            setTarget(v);
            setBlocked(null);
          }}
          error={shown.product}
        />
        <Input
          ref={sentenceRef}
          label="Describe it in a sentence"
          placeholder={picked?.library ? 'Softer, rounder buttons' : 'Billing screen with overdue invoices'}
          size="lg"
          value={sentence}
          onValueChange={setSentence}
          error={shown.sentence}
        />
        {jiraOpen ? (
          <Input ref={jiraRef} label="Jira ticket" hint="Optional. Its key, like DS-42." size="lg" value={jira} onValueChange={setJira} error={shown.jira} />
        ) : (
          <span>
            <Button
              variant="link"
              iconStart={Plus}
              onClick={() => {
                setJiraOpen(true);
                requestAnimationFrame(() => jiraRef.current?.focus());
              }}
            >
              Link a Jira ticket
            </Button>
          </span>
        )}
        {blocked && !error && (
          <Alert
            tone="warning"
            actions={
              <>
                <Button
                  variant="secondary"
                  iconStart={copied ? Check : Copy}
                  onClick={() => void copy(askAdmin(blocked.product, blocked.repo, blocked.reason, installUrl()).message, 'Message copied. Paste it to an admin.')}
                >
                  {copied ? 'Message copied' : askAdmin(blocked.product, blocked.repo, blocked.reason, installUrl()).label}
                </Button>
                <Button variant="link" disabled={busy} onClick={() => void start(true)}>
                  Start in the library instead
                </Button>
              </>
            }
          >
            {productRepoBlockedLine(blocked.product, blocked.reason)}
          </Alert>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {said}
        </span>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    );
    foot = footer(
      <Button variant="link" onClick={() => setStep('report')} disabled={busy}>
        Something looks wrong? Report it
      </Button>,
      <Button size="lg" type="submit" form="sc-start" loading={busy}>
        Start with Claude AI
      </Button>,
    );
  } else if (step === 'report') {
    title = 'Which component looks wrong?';
    body = (
      <div className="sc-form">
        <p className="t-body sc-line">Its page opens on the steps to report what does not match Figma.</p>
        <Combobox
          label="Component"
          placeholder="Type a name, for example Button"
          options={components.map((c) => ({ value: c.slug, label: c.name, description: c.family }))}
          value={slug}
          onValueChange={(v) => setSlug(typeof v === 'string' ? v : null)}
        />
      </div>
    );
    foot = footer(
      <Button
        variant="link"
        onClick={() => {
          setError(null);
          setTried(false);
          setStep('start');
        }}
      >
        Back
      </Button>,
      <Button size="lg" disabled={!slug} onClick={() => slug && go(startChangeHref('wrong', slug))}>
        Continue
      </Button>,
    );
  } else {
    title = 'Ready for Claude AI';
    body = (
      <div className="sc-form">
        <p className="t-body sc-line">
          <b>{done?.name}</b> is a new exploration in {done?.where}. Say this to Claude AI in Claude Code or Claude Desktop, with the Bridge MCP server:
        </p>
        <CodeBlock code={done?.prompt ?? ''} label="Say to Claude AI" />
      </div>
    );
    foot = footer(
      null,
      <Button size="lg" onClick={() => done && go(done.href)}>
        Open the exploration
      </Button>,
    );
  }

  const label = VOCAB.startExploration;
  const gate = 'start explorations';
  if (look.hidden && appearance === 'menu') return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal={step === 'start' && Boolean(sentence.trim())}>
      <DialogTrigger
        render={
          appearance === 'card' ? (
            <Button variant="ghost" iconStart={Plus} fullWidth className="sh-create-btn" data-start-change data-demo-write={gate}>
              {label}
            </Button>
          ) : appearance === 'choice' ? (
            <Button variant="link" className="sh-choice-btn" data-card-primary data-start-change data-demo-write={gate}>
              <span className="sh-choice-title">{label}</span>
            </Button>
          ) : appearance === 'button' ? (
            <Button variant="secondary" size="lg" iconStart={Plus} data-start-change data-demo-write={gate}>
              {label}
            </Button>
          ) : (
            <Button variant={look.variant} iconStart={Plus} fullWidth data-start-change data-demo-write={gate}>
              {label}
            </Button>
          )
        }
      />
      {open && (
        <DialogContent title={title} footer={foot} className="sc-dialog" initialFocus={step === 'start' ? sentenceRef : undefined}>
          {body}
        </DialogContent>
      )}
    </Dialog>
  );
}
