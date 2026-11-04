// "Start an exploration" (VOCAB.startExploration): the one way to start work in Studio, on the Changes header and the
// Studio home (rules and words: lib/create-branch.ts). A DS Dialog, one question: "What do you want to explore?"
//   - Where: a product, or, for a lead (libraryLead), the library itself (a token, a component or its guidance). A change
//     to the library is an exploration whose target is the library. A designer of the team only sees products, and
//     with one product no Where at all. Preselected from ?product= (key, name, or "library"), else the only
//     product, else the library when the team lists no product. For whoever may add a product (an admin with GitHub,
//     never the sample team: AddProduct's useCanAddProduct), a last "Add a product" after a separator, a plus in the
//     link color: it opens the Add a product dialog of Settings (AddProduct.tsx), then brings the person back here.
//   - What it is, in one sentence, and a Jira ticket on demand (only with JIRA_IN_BRIDGE). The primary follows the person's AI tool
//     (AiToolPanel.tsx, lib/ai-tools.ts): "Start with Claude AI" for Claude, "Start in Copilot" for GitHub Copilot
//     in VS Code. It starts the exploration the way the CLI and MCP server do (the core exploration start with the
//     product label from productMarks, none for the library), then the next step in that tool: the Claude app opens
//     a new Claude conversation with the line (the connect steps first while the viewer's Claude has no Bridge), the
//     terminal and Copilot copy it and say where to paste it. Several tools: tabs limited to them, the last one used
//     open; one tool: no tabs. "Open the exploration" stays beside it. A product with its own repository (bridge.config.json
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
import { Check, Copy, ExternalLink, Plus } from 'lucide-react';
import { defaultProduct, parseJiraKey, productMarks, productsOf, type ProductConfig } from '@bridge-ds/core';
import { Alert, Button, Combobox, Dialog, DialogContent, DialogTrigger, Icon, Input, Select } from '@bridge-ds/react';
import AddProduct, { useCanAddProduct } from './AddProduct';
import { ADD_PRODUCT_WORDS } from '../../../lib/add-product';
import { startChangeHref } from '../../../lib/overview-board';
import {
  adminBlockedFix,
  askAdmin,
  blockIsAdmins,
  claudePrompt,
  connectorPrompt,
  featureHref,
  featureName,
  featurePurpose,
  featureProblems,
  featureRepo,
  initialTarget,
  libraryLead,
  productParam,
  productRepoBlockedLine,
  startTargets,
} from '../../../lib/create-branch';
import { installUrl } from '../../../lib/access-view';
import { COPY_WORDS, madeLine, needsCopyAccess, type CopyAccess } from '../../../lib/design-copy';
import { CopyAccessStep } from './CopyAccessStep';
import { siteConfig } from '../../../scripts/repo-context';
import { isSampleTeam } from '../../../lib/demo';
import { JIRA_IN_BRIDGE } from '../../../lib/studio-flags';
import { useCopy } from './TeamLink';
import { CONNECT_FIRST, connectFirst, copilotSetup, connectorUrl, TERMINAL_SETUP_LINE, TERMINAL_SETUP_LINE_COPY, terminalSetup } from '../../../lib/claude-connector';
import type { AiTool } from '../../../lib/ai-tools';
import { ConnectClaudeButton, ConnectFirst, TOOL_SAID, ToolAction, ToolPanel, useAiTools, useClaudeRecheck, type ClaudeLink, type ToolLines, type ToolSetup } from './AiToolPanel';

/** The line for each tool once it started: the Claude app and Copilot Chat take the sentence, the terminal runs Claude Code with it. */
export function startLines(prompt: string, app?: string): ToolLines {
  return { 'claude-app': app ?? prompt, 'claude-code': `claude '${prompt.replace(/'/g, "'\\''")}'`, copilot: prompt };
}

/** The primary of the start step, for the open tool. */
export const startLabel = (tool: AiTool) => (tool === 'copilot' ? 'Start in Copilot' : 'Start with Claude AI');

/** Writes the line to the clipboard, or refuses (the panel then says to select it). */
const clip = (text: string) => navigator.clipboard.writeText(text);

export interface StartExplorationProps {
  components: { name: string; slug: string; family?: string }[];
  /**
   * `menu`: the page header's action (the Changes page), its weight set by the page.
   * `card`: the dashed first card of the home's explorations, always shown (the page only mounts it signed in).
   * `button`: a lone secondary button (the home's explorations when there are none yet).
   * `choice`: the title of a way-to-start card (a product page with nothing explored yet), the card's primary action.
   * `primary`: the home's one primary action when nothing needs the viewer, under "What do you want to explore?".
   */
  appearance?: 'menu' | 'card' | 'button' | 'choice' | 'primary';
  /** The product the start is for (a product page): "Where" is decided, shown as a read-only line instead of the Select. */
  product?: string | null;
}

export const START_CHANGE_EVENT = 'bridge:start-change';
/** Sent when the dialog opens or closes, so the page keeps one primary action (the dialog's). */
export const PICKER_EVENT = 'bridge:start-change-picker';

export interface StartChangeLook {
  variant: 'primary' | 'secondary';
  hidden: boolean;
}

type Step = 'start' | 'report' | 'done';

/** The Where list's last option: not a place to start, the way to add one (never a target). */
export const ADD_PRODUCT_OPTION = '__bridge-add-product';

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

export default function StartExploration({ components, appearance = 'menu', product = null }: StartExplorationProps) {
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
  const [blocked, setBlocked] = useState<{ product: string; repo: string; reason: 'not-connected' | 'read-only' | 'no-copy'; config?: ProductConfig } | null>(null);
  /** "Make my copy" from the dialog, for a product explored in the design team's copy that has none yet. */
  const [making, setMaking] = useState(false);
  // The copy is made but Bridge may not open it yet: the one more step on GitHub (CopyAccessStep).
  const [copyAccess, setCopyAccess] = useState<CopyAccess | null>(null);
  // Another product picked (or nothing blocks any more): that step was for the copy of the one before.
  useEffect(() => setCopyAccess(null), [blocked?.product, blocked?.reason]);
  const { copied, said, copy } = useCopy(3000);
  const [done, setDone] = useState<{ prompt: string; app: string; href: string; name: string; where: string; setup: ToolSetup } | null>(null);
  const [claudeLink, setClaudeLink] = useState<ClaudeLink>('unknown');
  const [toolSaid, setToolSaid] = useState('');
  // A designer (joined with their email, or with GitHub as a designer of the team): they explore a product in its design
  // team's copy, through Bridge, and the Claude app with Bridge is their one AI tool.
  const [email, setEmail] = useState(false);
  const tools = useAiTools(claudeLink, email);
  // The last step while the viewer's own Claude has no Bridge: read again when they come back from Claude.
  const first = step === 'done' && connectFirst(tools.tab, claudeLink);
  useClaudeRecheck(first, (v) => {
    setClaudeLink(v);
    if (v === 'yes') setToolSaid(CONNECT_FIRST.connected);
  });
  const sentenceRef = useRef<HTMLInputElement>(null);
  const jiraRef = useRef<HTMLInputElement>(null);
  // Back from GitHub (a sign-in): "Back from GitHub. Start this exploration now?", Start focused.
  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);

  // A lead may also start in the library; until the access is known, only the products (a lead sees it a moment later).
  const [lead, setLead] = useState(false);
  // An admin of the team (email or GitHub): a product Bridge cannot reach is theirs to set up, never "Ask an admin".
  const [admin, setAdmin] = useState(false);
  const targets = startTargets(products, { library: lead });
  // An admin may add a product right from Where; the dialog closes for Add a product's, then comes back as it was.
  const canAdd = useCanAddProduct();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const picked = targets.find((t) => t.value === target) ?? null;

  // Where the page asked to start, and whether the person picked since: the lead's library comes a moment after open.
  const asked = useRef<string | null>(null);
  const pickedByHand = useRef(false);
  const reset = (all: ProductConfig[], fromPage: string | null) => {
    asked.current = fromPage;
    pickedByHand.current = false;
    setStep('start');
    setSlug(null);
    setTarget(initialTarget(startTargets(all, { library: lead }), fromPage));
    setSentence('');
    setJira('');
    setJiraOpen(false);
    setTried(false);
    setBusy(false);
    setError(null);
    setBlocked(null);
    setDone(null);
    setAdded(false);
    setResumeNote(null);
  };

  useEffect(() => {
    const on = (e: Event) => setLook((e as CustomEvent<StartChangeLook>).detail);
    document.addEventListener(START_CHANGE_EVENT, on);
    setLook(pageLook());
    const all = pageProducts();
    setProducts(all);
    // Back from GitHub (scripts/pending-action.ts): the start reopens with what was typed. Only a visible start
    // takes it, once per page; nothing starts before the click.
    if (!(pageLook().hidden && appearance === 'menu'))
      void import('../../../scripts/resume')
        .then(({ takeResume }) => {
          const r = takeResume('start-exploration');
          if (!r) return;
          const v = r.action.values;
          reset(all, null);
          if (typeof v.target === 'string' && v.target) {
            pickedByHand.current = true;
            setTarget(v.target);
          }
          if (typeof v.sentence === 'string') setSentence(v.sentence);
          if (typeof v.jira === 'string' && v.jira) {
            setJira(v.jira);
            setJiraOpen(true);
          }
          setResumeNote(r.line);
          setOpen(true);
        })
        .catch(() => undefined);
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
    const c = siteConfig();
    if (isSampleTeam(c.owner && c.repo ? `${c.owner}/${c.repo}` : null)) setLead(true);
    // Setting state after an unmount is a no-op in React 18: no guard, so a remount never loses the access.
    else
      void import('../../../scripts/github-session')
        .then((m) => {
          setEmail(Boolean(m.currentContributor()));
          // A designer signed in with GitHub works like an email member in the products (through Bridge) and, like
          // them, is not a lead of the library.
          m.onAccess((a) => {
            const designer = m.designerRoute();
            setLead(libraryLead(a) && !designer);
            setAdmin(Boolean(a?.admin));
            if (designer) setEmail(true);
          });
        })
        .catch(() => undefined);
  }, []);

  // Known before they type: a product with no design copy is out of an email member's reach, so say it at once.
  useEffect(() => {
    if (!open || !email || !picked || picked.library) return;
    const c = siteConfig();
    const repo = featureRepo(picked.product, `${c.owner}/${c.repo}`);
    if (repo && !picked.product.design?.repo) setBlocked({ product: picked.product.name, repo, reason: 'read-only', config: picked.product });
    else setBlocked((b) => (b && b.product === picked.product.name ? b : null));
  }, [open, email, target]);

  // The access said lead after the dialog opened: pick again from what the page asked (the library, say).
  useEffect(() => {
    if (lead && open && !pickedByHand.current) setTarget(initialTarget(startTargets(products, { library: true }), asked.current));
  }, [lead]);

  useEffect(() => {
    document.dispatchEvent(new CustomEvent(PICKER_EVENT, { detail: { open } }));
  }, [open]);

  const onOpenChange = (next: boolean) => {
    if (busy) return;
    if (next) {
      reset(products, product ?? productParam(location.search));
      setToolSaid('');
      // The connect steps come first on the Claude app path while the viewer's own Claude has no Bridge.
      void import('../../../scripts/claude-link').then((m) => {
        setClaudeLink(m.knownClaudeLink());
        void m.viewerClaudeLink().then(setClaudeLink);
      });
    }
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
    setResumeNote(null);
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
    // Kept if the person has to sign in again first: the start reopens with the same words (scripts/pending-action).
    const kept = await import('../../../scripts/pending-action');
    kept.armPendingAction('start-exploration', { sentence, target, jira });
    try {
      const { explorationsConfig, startInProductRepo, startLinkedExploration } = await import('../../../scripts/exploration-start');
      const key = parseJiraKey(jira);
      const author = session.currentViewer()?.login;
      const name = featureName(sentence);
      const cfg = explorationsConfig();
      const e = { name, purpose: featurePurpose(sentence), useCase: 'terminal' as const, ...(author ? { author } : {}), ...(key ? { jira: key } : {}) };
      const labels = productMarks(products, t.product).labels;
      const repo = inLibrary || t.library ? null : featureRepo(t.product, `${cfg.owner}/${cfg.repo}`);
      // In the design team's copy (products[].design): the copy's previews, and the developers' repository never written.
      const { copyRepos } = await import('../../../scripts/design-copy');
      const at = repo ? copyRepos(t.product) : null;
      const template = at ? t.product.design?.preview : t.product.preview;
      const r = repo
        ? await startInProductRepo(repo, e, labels, { name: t.product.name, library: `${cfg.owner}/${cfg.repo}`, ...(template ? { preview: template } : {}), ...(at ? { copyOf: at.code } : {}) })
        : await startLinkedExploration(cfg, e, null, labels);
      if ('blocked' in r) {
        setBlocked({ product: t.product.name, repo: repo!, reason: r.blocked, config: t.product });
        return;
      }
      setBlocked(null);
      kept.disarmPendingAction();
      const { started } = r;
      const ds = `${cfg.owner}/${cfg.repo}`;
      const ref = { sentence, product: t.product, number: started.pr, library: t.library, copy: at ? { repo: at.copy, branch: started.branch } : null };
      const prompt = claudePrompt(ref);
      setDone({
        prompt,
        // The Claude app goes through the Bridge connector, which finds the exploration from its ref alone.
        app: connectorPrompt(ref),
        href: featureHref(started.pr, repo ? t.product.key : null),
        name,
        where: t.library ? VOCAB.main : t.product.name,
        // A product with its own repository needs bridge connect once there; the library and a product folder in the
        // design system repository need the server in the tool once.
        setup: {
          'claude-code': repo ? { label: at ? TERMINAL_SETUP_LINE_COPY : TERMINAL_SETUP_LINE, command: terminalSetup(ds) } : null,
          copilot: copilotSetup(ds, Boolean(repo)),
        },
      });
      setStep('done');
      // Copilot and the terminal: the line goes on the clipboard right away (the click that started it allows it).
      if (tools.tab !== 'claude-app') {
        const tab = tools.tab;
        void clip(startLines(prompt, connectorPrompt(ref))[tab]).then(
          () => setToolSaid(TOOL_SAID[tab].copied),
          () => setToolSaid(''),
        );
      }
    } catch (err) {
      const msg = (err as Error).message || 'GitHub did not answer.';
      // Suggest mode: the sentence already says what to do.
      const plain = (err as Error).name === 'SuggestOnlyError';
      setError(plain ? msg : `${msg.replace(/\.?$/, '.')} Try again, or rename it if one with this name already exists.`);
    } finally {
      setBusy(false);
    }
  }

  // The picked product is blocked (no copy yet, or Bridge cannot open it): starting cannot work until it is fixed.
  const stuck = Boolean(blocked) && !error;
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
        {/* A product page already decided where: one read-only line, no dropdown. Elsewhere the person picks. */}
        {/* One product and no library (a designer of the team): where is implied, no field. */}
        {!product && targets.length === 1 && !targets[0]!.library ? null : product && picked ? (
          <dl className="sc-where" data-where-fixed="">
            <dt className="t-ui sc-where-label">Where</dt>
            <dd className="sc-where-value">
              <span className="t-body">{picked.label}</span>
              {picked.description && <span className="t-ui t-muted">{picked.description}</span>}
            </dd>
          </dl>
        ) : (
          <Select
            label="Where"
            placeholder="Pick a product or the library"
            size="lg"
            options={[
              ...targets.map((t) => ({ value: t.value, label: t.label, ...(t.description ? { description: t.description } : {}) })),
              // After a separator (its own group, no heading): an action, set apart by the plus and the link color.
              ...(canAdd
                ? [
                    {
                      value: ADD_PRODUCT_OPTION,
                      label: ADD_PRODUCT_WORDS.open,
                      group: '',
                      badge: (
                        <span className="addp-option-mark" aria-hidden="true">
                          <Icon icon={Plus} size="sm" />
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
            value={target}
            onValueChange={(v) => {
              if (v === ADD_PRODUCT_OPTION) {
                setOpen(false);
                setAdding(true);
                return;
              }
              pickedByHand.current = true;
              setTarget(v);
              setBlocked(null);
            }}
            error={shown.product}
          />
        )}
        <Input
          ref={sentenceRef}
          label="Describe it in a sentence"
          placeholder={picked?.library ? 'Softer, rounder buttons' : 'Billing screen with overdue invoices'}
          size="lg"
          value={sentence}
          onValueChange={setSentence}
          error={shown.sentence}
        />
        {!JIRA_IN_BRIDGE ? null : jiraOpen ? (
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
        {blocked?.reason === 'no-copy' && copyAccess && !error && (
          <CopyAccessStep
            access={copyAccess}
            onVisible={async () => {
              const config = blocked.config;
              if (!config) return;
              const { finishCopy } = await import('../../../scripts/design-copy');
              const r = await finishCopy(config);
              setCopyAccess(null);
              if (r === 'ready') {
                setBlocked(null);
                await start();
              } else setError(madeLine(blocked.product, r));
            }}
          />
        )}
        {blocked?.reason === 'no-copy' && !copyAccess && !error && (
          <Alert
            tone="info"
            id="sc-blocked"
            actions={
              <Button
                variant="primary"
                loading={making}
                onClick={() =>
                  void (async () => {
                    if (!blocked.config || making) return;
                    setMaking(true);
                    try {
                      const { makeCopy } = await import('../../../scripts/design-copy');
                      const r = await makeCopy(blocked.config);
                      if (needsCopyAccess(r)) setCopyAccess(r);
                      else if (r === 'ready') {
                        setBlocked(null);
                        await start();
                      } else setError(madeLine(blocked.product, r));
                    } finally {
                      setMaking(false);
                    }
                  })()
                }
              >
                {COPY_WORDS.make}
              </Button>
            }
          >
            {making ? COPY_WORDS.making : COPY_WORDS.noCopyStart(blocked.product)}
          </Alert>
        )}
        {blocked && blocked.reason !== 'no-copy' && !error && blockIsAdmins({ admin, email, reason: blocked.reason }) && (
          <Alert
            tone="warning"
            id="sc-blocked"
            actions={
              <Button variant="primary" iconStart={ExternalLink} onClick={() => window.open(installUrl(), '_blank', 'noopener')}>
                {adminBlockedFix(blocked.product, blocked.reason).label}
              </Button>
            }
          >
            {adminBlockedFix(blocked.product, blocked.reason).line}
          </Alert>
        )}
        {blocked && blocked.reason !== 'no-copy' && !error && !blockIsAdmins({ admin, email, reason: blocked.reason }) && (
          <Alert
            tone="warning"
            id="sc-blocked"
            actions={
              <>
                <Button
                  variant="primary"
                  iconStart={copied ? Check : Copy}
                  onClick={() => void copy(askAdmin(blocked.product, blocked.repo, blocked.reason as 'not-connected' | 'read-only', installUrl(), email).message, 'Message copied. Paste it to an admin.')}
                >
                  {copied ? 'Message copied' : askAdmin(blocked.product, blocked.repo, blocked.reason, installUrl(), email).label}
                </Button>
                {lead && (
                  <Button variant="link" disabled={busy} onClick={() => void start(true)}>
                    Start in the library instead
                  </Button>
                )}
              </>
            }
          >
            {productRepoBlockedLine(blocked.product, blocked.reason, lead)}
          </Alert>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {said}
        </span>
        {error && <Alert tone="danger">{error}</Alert>}
        {added && <Alert tone="success">{ADD_PRODUCT_WORDS.sent}</Alert>}
        {resumeNote && !error && (
          <p className="t-body sc-line" role="status">
            {resumeNote}
          </p>
        )}
      </form>
    );
    foot = footer(
      <Button variant="link" onClick={() => setStep('report')} disabled={busy}>
        Something looks wrong? Report it
      </Button>,
      // While the product is blocked, starting cannot work: the warning's action is the one primary, and Start waits,
      // disabled, its reason the warning it points to (aria-describedby). Picking another place clears it.
      <Button ref={startRef} size="lg" type="submit" form="sc-start" loading={busy} disabled={stuck} aria-describedby={stuck ? 'sc-blocked' : undefined}>
        {startLabel(tools.tab)}
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
    const lines = startLines(done?.prompt ?? '', done?.app);
    const panel = <ToolPanel tools={tools.view.tools} tab={tools.tab} setTab={tools.setTab} chosen={tools.view.chosen} lines={lines} setup={done?.setup ?? {}} onCopy={clip} say={setToolSaid} />;
    title = tools.tab === 'copilot' ? 'Ready for Copilot' : 'Ready for Claude AI';
    body = (
      <div className="sc-form">
        <p className="t-body sc-line">
          <b>{done?.name}</b> is a new exploration in {done?.where}. {first ? CONNECT_FIRST.readyIntro : toolSaid || (tools.tab === 'copilot' ? 'Paste this in Copilot Chat in VS Code, in Agent mode.' : tools.tab === 'claude-code' ? 'Run this in your terminal.' : 'Continue it in Claude.')}
        </p>
        {first ? (
          <ConnectFirst address={connectorUrl(location.origin)} onCopy={clip}>
            {panel}
          </ConnectFirst>
        ) : (
          panel
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {toolSaid}
        </span>
      </div>
    );
    foot = footer(
      <Button variant="link" onClick={() => done && go(done.href)}>
        Open the exploration
      </Button>,
      first ? <ConnectClaudeButton /> : <ToolAction
        tool={tools.tab}
        line={lines[tools.tab]}
        onCopy={clip}
        say={setToolSaid}
        variant="primary"
        claudeLink={claudeLink}
        connectorAddress={connectorUrl(location.origin)}
        onClaudeConnected={() => void import('../../../scripts/claude-link').then((m) => m.forgetClaudeLink())}
      />,
    );
  }

  const label = VOCAB.startExploration;
  const gate = 'start explorations';
  if (look.hidden && appearance === 'menu') return null;
  // The library's own page: starting there is a lead's; a designer asks for a library change on Components instead.
  if (!lead && product && products.length && product === defaultProduct(products).key) return null;
  return (
    <>
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
            ) : appearance === 'primary' ? (
              <Button variant="primary" className="sh-start-btn" data-start-change data-demo-write={gate}>
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
          <DialogContent title={title} footer={foot} className="sc-dialog" initialFocus={step === 'start' ? (resumeNote ? startRef : sentenceRef) : undefined}>
            {body}
          </DialogContent>
        )}
      </Dialog>
      {canAdd && (
        <AddProduct
          open={adding}
          onOpenChange={(o) => {
            setAdding(o);
            // Sent or cancelled: back to the exploration as it was (what they typed stays).
            if (!o) setOpen(true);
          }}
          onSent={() => setAdded(true)}
        />
      )}
    </>
  );
}
