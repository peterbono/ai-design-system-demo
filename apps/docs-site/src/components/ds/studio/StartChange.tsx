// "Create branch" (VOCAB.createBranch, Figma's word) on the Studio home and the Branches header: a DS Dialog, product
// first, since most work is a feature in a product (rules and words: lib/create-branch.ts).
//   Step 1 of 2, "What are you working on?": A feature in a product, or A change to the library (DS ChoiceCards), and
//   a quiet "Something looks wrong? Report it". Skipped when bridge.config.json lists no product but the library.
//   Step 2 of 2, a feature: what it is (one sentence), in which product (DS Select, preselected from ?product= or when
//   there is one), a Jira ticket on demand. "Start with Claude AI" starts it the way the CLI and MCP server do for a
//   product (the core exploration start with the product label from productMarks), then says what to tell Claude
//   and opens the branch.
//   Step 2 of 2, the library: Adjust the look (Studio Tokens), Add a variant or option (the component, then its
//   Components drawer on that intent), New component (Explorations with the start form open). Report it: the
//   component, then its drawer on "Something looks wrong". Same addresses as before (lib/overview-board).
// The page decides the trigger's weight (`bridge:start-change`): the primary when nothing needs the viewer, secondary
// when the first need is the primary, hidden signed out (Connect GitHub takes its place).
import { VOCAB } from '../../../lib/vocabulary';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { parseJiraKey, productMarks, productsOf, type ProductConfig } from '@bridge-ds/core';
import {
  Alert,
  Button,
  ChoiceCard,
  ChoiceCardGroup,
  CodeBlock,
  Combobox,
  Dialog,
  DialogContent,
  DialogTrigger,
  Input,
  Select,
} from '@bridge-ds/react';
import { CHANGE_INTENTS, type ChangeIntent } from '../../../lib/change-intent';
import { startChangeHref } from '../../../lib/overview-board';
import { claudePrompt, featureHref, featureName, featureProblems, featureProducts, firstStep, initialProduct, KIND_CHOICES, productParam, type WorkKind } from '../../../lib/create-branch';
import { siteConfig } from '../../../scripts/repo-context';

export interface StartChangeProps {
  components: { name: string; slug: string; family?: string }[];
  /**
   * `card`: the dashed first card of the home's explorations, always shown (the page only mounts it signed in).
   * `button`: a lone secondary button (the home's explorations when there are none yet).
   */
  appearance?: 'menu' | 'card' | 'button';
  /**
   * "Start an exploration" (the Studio home's explorations): the same flow on its product step, a feature in a product
   * tried with Claude AI, with no question about the library first.
   */
  exploration?: boolean;
}

/** Where an exploration starts when the team lists no product but the library: the Explorations start form. */
const EXPLORATION_FORM = () => startChangeHref('new');

export const START_CHANGE_EVENT = 'bridge:start-change';
/** Sent when the dialog opens or closes, so the page keeps one primary action (the dialog's). */
export const PICKER_EVENT = 'bridge:start-change-picker';

export interface StartChangeLook {
  variant: 'primary' | 'secondary';
  hidden: boolean;
}

type Step = 'kind' | 'feature' | 'library' | 'report' | 'done';
type LibraryChoice = 'look' | 'variant' | 'new';

const intentLabel = (v: ChangeIntent) => CHANGE_INTENTS.find((o) => o.value === v)!.label;

/** The library choices, one plain line under each: what it leads to. */
const LIBRARY: { value: LibraryChoice; label: string; line: string }[] = [
  { value: 'look', label: intentLabel('look'), line: 'Colors, radius, spacing and type, in the tokens.' },
  { value: 'variant', label: intentLabel('variant'), line: 'A developer builds it with Claude from your Figma frame.' },
  { value: 'new', label: 'New component', line: 'Try it first in an exploration.' },
];

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

const Title = ({ step, children }: { step?: string; children: ReactNode }) => (
  <>
    {step && <span className="sc-step">{step}</span>}
    {children}
  </>
);

export default function StartChange({ components, appearance = 'menu', exploration = false }: StartChangeProps) {
  // The server render and the first client render agree; the page's choice comes in right after.
  const [look, setLook] = useState<StartChangeLook>({ variant: 'primary', hidden: false });
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<ProductConfig[]>([]);
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<WorkKind>('feature');
  const [lib, setLib] = useState<LibraryChoice>('look');
  const [slug, setSlug] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [sentence, setSentence] = useState('');
  const [jira, setJira] = useState('');
  const [jiraOpen, setJiraOpen] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ prompt: string; href: string; name: string; product: string } | null>(null);
  const sentenceRef = useRef<HTMLInputElement>(null);
  const jiraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: Event) => setLook((e as CustomEvent<StartChangeLook>).detail);
    document.addEventListener(START_CHANGE_EVENT, on);
    setLook(pageLook());
    setProducts(pageProducts());
    return () => document.removeEventListener(START_CHANGE_EVENT, on);
  }, []);

  useEffect(() => {
    document.dispatchEvent(new CustomEvent(PICKER_EVENT, { detail: { open } }));
  }, [open]);

  const choices = featureProducts(products);
  const start = firstStep(choices);

  const reset = () => {
    setStep(exploration ? 'feature' : start);
    setKind('feature');
    setLib('look');
    setSlug(null);
    setProduct(initialProduct(choices, productParam(location.search)));
    setSentence('');
    setJira('');
    setJiraOpen(false);
    setTried(false);
    setBusy(false);
    setError(null);
    setDone(null);
  };

  const onOpenChange = (next: boolean) => {
    if (busy) return;
    // No product to explore in but the library: the exploration starts on the Explorations form.
    if (next && exploration && !choices.length) {
      location.href = EXPLORATION_FORM();
      return;
    }
    if (next) reset();
    setOpen(next);
  };

  const go = (href: string) => {
    location.href = href;
  };

  const problems = featureProblems({ product, sentence, jira }, choices);
  const shown = tried ? problems : {};

  async function startFeature() {
    setTried(true);
    setError(null);
    if (Object.keys(problems).length) {
      if (problems.sentence) sentenceRef.current?.focus();
      else if (problems.jira) jiraRef.current?.focus();
      return;
    }
    const p = choices.find((x) => x.key === product)!;
    const session = await import('../../../scripts/github-session');
    if (!session.hasWorkingToken()) {
      const { ghAction } = await import('../../../lib/gh-wording');
      setError(`${ghAction('start it here', session.prefersSignIn())}.`);
      return;
    }
    setBusy(true);
    try {
      const { explorationsConfig, startLinkedExploration } = await import('../../../scripts/exploration-start');
      const key = parseJiraKey(jira);
      const author = session.currentViewer()?.login;
      const name = featureName(sentence);
      const { started } = await startLinkedExploration(
        explorationsConfig(),
        { name, purpose: sentence.trim(), useCase: 'terminal', ...(author ? { author } : {}), ...(key ? { jira: key } : {}) },
        null,
        productMarks(products, p).labels,
      );
      setDone({ prompt: claudePrompt({ sentence, product: p, number: started.pr }), href: featureHref(started.pr), name, product: p.name });
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

  const back = (to: Step) => () => {
    setError(null);
    setTried(false);
    setStep(to);
  };
  const stepTwo = start === 'kind' && !exploration ? 'Step 2 of 2' : undefined;
  const lead = (s: Step) => (s === 'kind' ? 'Step 1 of 2' : s === 'feature' ? (stepTwo ? `${stepTwo} · A feature in a product` : undefined) : s === 'library' ? (stepTwo ? `${stepTwo} · A change to the library` : undefined) : s === 'report' ? `${stepTwo ?? 'Step 2 of 2'} · Something looks wrong` : undefined);

  const componentField = (label: string) => (
    <Combobox
      label={label}
      placeholder="Type a name, for example Button"
      options={components.map((c) => ({ value: c.slug, label: c.name, description: c.family }))}
      value={slug}
      onValueChange={(v) => setSlug(typeof v === 'string' ? v : null)}
    />
  );

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
  if (step === 'kind') {
    title = <Title step={lead('kind')}>What are you working on?</Title>;
    body = (
      <ChoiceCardGroup label="What are you working on?" hideLabel orientation="vertical" value={kind} onValueChange={(v) => setKind(v as WorkKind)}>
        {KIND_CHOICES.map((c) => (
          <ChoiceCard key={c.value} value={c.value} title={c.title} description={c.line} />
        ))}
      </ChoiceCardGroup>
    );
    foot = footer(
      <Button variant="link" onClick={() => setStep('report')}>
        Something looks wrong? Report it
      </Button>,
      <Button size="lg" onClick={() => setStep(kind)}>
        Continue
      </Button>,
    );
  } else if (step === 'feature') {
    title = <Title step={lead('feature')}>{exploration ? 'What do you want to explore?' : 'What are you building?'}</Title>;
    body = (
      <form
        className="sc-form"
        id="sc-feature"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void startFeature();
        }}
      >
        <Select
          label="In which product"
          placeholder="Pick a product"
          size="lg"
          options={choices.map((p) => ({ value: p.key, label: p.name }))}
          value={product}
          onValueChange={setProduct}
          error={shown.product}
        />
        <Input
          ref={sentenceRef}
          label="Describe it in a sentence"
          placeholder="Billing screen with overdue invoices"
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
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    );
    foot = footer(
      start === 'kind' && !exploration ? (
        <Button variant="link" onClick={back('kind')} disabled={busy}>
          Back
        </Button>
      ) : null,
      <Button size="lg" type="submit" form="sc-feature" loading={busy}>
        Start with Claude AI
      </Button>,
    );
  } else if (step === 'library') {
    title = <Title step={lead('library')}>What do you want to change?</Title>;
    body = (
      <div className="sc-form">
        <ChoiceCardGroup label="What do you want to change?" hideLabel orientation="vertical" value={lib} onValueChange={(v) => setLib(v as LibraryChoice)}>
          {LIBRARY.map((o) => (
            <ChoiceCard key={o.value} value={o.value} title={o.label} description={o.line} />
          ))}
        </ChoiceCardGroup>
        {lib === 'variant' && componentField('Which component gets the new option?')}
      </div>
    );
    foot = footer(
      start === 'kind' ? (
        <Button variant="link" onClick={back('kind')}>
          Back
        </Button>
      ) : (
        // No kind question (the library is the only product): the report door moves here.
        <Button variant="link" onClick={() => setStep('report')}>
          Something looks wrong? Report it
        </Button>
      ),
      <Button size="lg" disabled={lib === 'variant' && !slug} onClick={() => go(startChangeHref(lib, lib === 'variant' ? slug ?? undefined : undefined))}>
        Continue
      </Button>,
    );
  } else if (step === 'report') {
    title = <Title step={lead('report')}>Which component looks wrong?</Title>;
    body = (
      <div className="sc-form">
        <p className="t-body sc-line">Its page opens on the steps to report what does not match Figma.</p>
        {componentField('Component')}
      </div>
    );
    foot = footer(
      <Button variant="link" onClick={back(start)}>
        Back
      </Button>,
      <Button size="lg" disabled={!slug} onClick={() => slug && go(startChangeHref('wrong', slug))}>
        Continue
      </Button>,
    );
  } else {
    title = <Title>Ready for Claude AI</Title>;
    body = (
      <div className="sc-form">
        <p className="t-body sc-line">
          <b>{done?.name}</b> is a new {exploration ? 'exploration' : VOCAB.branch} in {done?.product}. Say this to Claude AI in Claude Code or Claude Desktop, with the Bridge MCP server:
        </p>
        <CodeBlock code={done?.prompt ?? ''} label="Say to Claude AI" />
      </div>
    );
    foot = footer(
      null,
      <Button size="lg" onClick={() => done && go(done.href)}>
        Open the {exploration ? 'exploration' : VOCAB.branch}
      </Button>,
    );
  }

  const card = appearance === 'card';
  const label = exploration ? 'Start an exploration' : VOCAB.createBranch;
  const gate = exploration ? 'start explorations' : 'start changes';
  if (look.hidden && appearance === 'menu') return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal={step === 'feature' && Boolean(sentence.trim())}>
      <DialogTrigger
        render={
          card ? (
            <Button variant="ghost" iconStart={Plus} fullWidth className="sh-create-btn" data-start-change data-demo-write={gate}>
              {label}
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
        <DialogContent title={title} footer={foot} className="sc-dialog" initialFocus={step === 'feature' ? sentenceRef : undefined}>
          {body}
        </DialogContent>
      )}
    </Dialog>
  );
}
