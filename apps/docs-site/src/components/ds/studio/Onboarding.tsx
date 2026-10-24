// Studio onboarding (rules and words in lib/onboarding.ts), mounted by pages/studio/index.astro:
//   - Onboarding: the first run. The eight steps on the left (the open one highlighted, any row opens its step), the
//     open step in one card on the right. Opens on "How changes reach your code" while bridge.config.json does not
//     say it. Every step after sign-in can wait: "Do this later" goes to the home.
//   - FinishConnecting: on the home once the first run is behind, "4 of 8 connected" opens the steps left as a
//     compact checklist. "Hide checklist" puts it away for this browser.
// Step 2 (your design system): a self-hosted Studio is built for one repository, so it is connected from the start.
// On a team's Bridge (hosted, HostedOnboarding below) it says what GitHub said: connected, read only, or "Install
// Bridge" (admins) / "Ask an admin to install Bridge" (everyone else) while Bridge is not set up on the repository.
// The Storybook quick start (StorybookField) reads a published Storybook and keeps it in this browser; once added,
// the card says how many components it found and links to them.
// Step 3 (Name your team): one field prefilled with the repository name in words; Save name opens the config pull
// request that sets `name` (scripts/roles.ts proposeTeamName), the same way as the changes step.
// Step 5 (Invite your team): the team link and "Who can do what" (TeamLink.tsx); copying the link marks it done.
// The browser workspace (lib/start.ts, pages/studio/workspace.astro): six steps and no repository yet. Step 2 takes a
// Storybook, or a repository that opens its team at the next step; the steps that need the repository say so.
// Signed in with a Bridge account, it is "Create your team" (boards E6 and E7a): step 1 names the team and, for a work
// email, offers "Let people with @acme.com find this team" (checked); a public email gets one line instead. Continue
// creates the team on the server (api/entry create-team): its creator is its admin, colleagues find it, and "Your
// team" is done only then. Under the steps, "Expecting an invite?" names the email to give the design lead. Step 2 asks
// for GitHub only to link the repository, which the team then moves to (linkRepo).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { bridgeMcpInstallCommand, type ChangesMode, type RepoAccessState } from '@bridge-ds/core';
import { Accordion, AccordionItem, Badge, Button, Card, CardBody, Checkbox, CodeBlock, Icon, Input, Link, Popover, PopoverContent, PopoverTrigger, Progress } from '@bridge-ds/react';
import { Drawing } from './Drawing';
import ButtonLink from '../ButtonLink';
import { ChangesChoices, DevelopersGet } from './ChangesMode';
import { StorybookField } from './StorybookField';
import { TeamField } from './TeamLauncher';
import { TeamLink, useCopy } from './TeamLink';
import { askInstallMessage, installUrl } from '../../../lib/access-view';
import type { WorkspaceStorybook } from '../../../lib/workspace';
import { doneCount, doneSummary, firstRunTitle, onboardingKey, onboardingSteps, parseMemory, progressLabel, readMemoryText, STEP_IDS, STEP_LINE, STEP_TITLE, withSetupStep, type OnboardingMemory, type Step, type StepId } from '../../../lib/onboarding';
import { CHANGES_CHOICE } from '../../../lib/settings-view';
import { VOCAB } from '../../../lib/vocabulary';
import { STUDIO_ROOT, studioHref } from '../../../lib/team-path';
import { DEMO_HOME, NEXT_AFTER_LIBRARY, type PendingLink } from '../../../lib/start';
import { knownTeamName } from '../../../lib/recent-teams';
import { ENTRY_WORDS, teamNameFromDomain } from '../../../lib/entry';
import { readStart, rememberStart } from '../../../scripts/start';
import { humanizeRepo } from '../../../lib/demo';
import { TEAM_NAME_WORDS, teamNameProblem } from '../../../lib/team-name';

export interface OnboardingContext {
  repo: string;
  repoUrl: string;
  storybook: string | null;
  /** The Storybook added in this browser with the quick start (scripts/workspace.ts). */
  quickStart?: WorkspaceStorybook | null;
  products: { name: string; path?: string }[];
  /** The one-time command that adds the Bridge MCP to Claude Code for this repository. */
  mcpCommand: string;
  /** Where the Figma plugin is installed from, and the Claude set-up page. */
  figmaHref: string;
  claudeHref: string;
  /** Step "Invite your team": the team link and what decides who can do what. */
  team: {
    owner: string;
    repo: string;
    link: string;
    access: RepoAccessState | null;
    changes: ChangesMode | null;
    owners?: { design?: string[]; tech?: string[] };
  };
  /** A team's Bridge (hosted): what GitHub said, for step 2. Absent on the self-hosted site. */
  hosted?: { access: RepoAccessState | null; admin: boolean } | null;
  /** The browser workspace: no repository yet. */
  workspace?: boolean;
  /**
   * Step 1 while signed out: the sign-in button's words, and whether it goes straight to GitHub. `href`: the site has
   * accounts, so step 1 opens the one sign-in screen (email) and comes back here.
   */
  signIn?: { button: string; direct: boolean; href?: string | undefined };
  /**
   * "Create your team" (board E6): the browser workspace of a Bridge account. `domain`: the work domain, null for a
   * public email (no "find this team" choice); `github`: GitHub is signed in on this browser, so step 2 can pick a repo.
   */
  account?: {
    email: string;
    domain: string | null;
    /** The team made on the server, once step 1 created it: its name, and whether the work domain finds it. */
    teamName: string | null;
    discover?: boolean;
    github: boolean;
  } | null;
  /** The team's name typed in "Create your team", before the repository named it (step "Name your team"). */
  suggestedName?: string | null;
}

export interface OnboardingActions {
  /** Opens the pull request that sets `changes`; resolves with it, rejects with a sentence. */
  propose: (mode: ChangesMode) => Promise<{ number: number; url: string }>;
  /** Opens the pull request that sets the team's name; resolves with it, rejects with a sentence. */
  name?: (name: string) => Promise<{ number: number; url: string }>;
  /** Marks the Figma plugin or Claude AI step done in this browser. */
  mark: (id: StepId) => void;
  /** Leaves the steps for the home, from the step that was open. */
  later: (at: StepId) => void;
  /** The open step changed (the browser workspace remembers it, to resume there). */
  onOpen?: (id: StepId) => void;
  /** "Create your team" step 1: creates (or renames) the team on the server; rejects with a sentence. */
  createTeam?: (name: string, discover: boolean) => Promise<void>;
  /**
   * Step 2 of "Create your team", a repository picked: links it to the team before its page opens. Resolves with a
   * sentence that keeps the person on the step (they do not administer it), else null.
   */
  linkRepo?: (owner: string, repo: string) => Promise<string | null>;
  /** Step 2 of "Create your team": links GitHub to the account, then comes back here. */
  connectGitHub?: () => void;
}

function StepMark({ s }: { s: Step }) {
  return (
    <span className="onb-mark" data-state={s.state} aria-hidden="true">
      {s.state === 'done' ? <Icon icon={Check} size="xs" /> : s.n}
    </span>
  );
}

function StepText({ s }: { s: Step }) {
  return (
    <span className="onb-step-text">
      <span className="onb-step-title">{s.title}</span>
      <span className="onb-step-detail">
        {s.detail}
        {s.code && (
          <>
            {' '}
            <span className="mono">{s.code}</span>
          </>
        )}
      </span>
    </span>
  );
}

/** The steps as a list; every row opens its step. */
function StepList({ steps, open, onOpen }: { steps: Step[]; open: StepId; onOpen: (id: StepId) => void }) {
  return (
    <ol className="onb-steps" aria-label="Setup steps">
      {steps.map((s) => (
        <li key={s.id}>
          {/* bridge-audit-ignore-next-line: the whole step row (mark, title, detail, status) is one target that opens the step, like the review queue rows; the DS has no row button and Button would truncate it to one label */}
          <button type="button" className="onb-step" data-state={s.state} aria-current={s.id === open ? 'step' : undefined} onClick={() => onOpen(s.id)}>
            <StepMark s={s} />
            <StepText s={s} />
            {/* "Current" belongs to the open step only: the step Bridge waits on reads "To do" while another one is open. */}
            <span className="onb-step-status">{s.status === 'Current' && s.id !== open ? 'To do' : s.status}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Panel({ step, total, title, lead, children, footer }: { step: Step; total: number; title: string; lead: ReactNode; children?: ReactNode; footer: ReactNode }) {
  return (
    <Card className="onb-panel" aria-labelledby="onb-panel-title">
      <CardBody className="onb-panel-body">
        <div className="onb-panel-head">
          <p className="onb-quiet">
            Step {step.n} of {total}
          </p>
          {/* tabIndex -1: focus lands here when another step opens, so keyboard and screen reader users follow. */}
          <h2 id="onb-panel-title" className="onb-h2" tabIndex={-1}>
            {title}
          </h2>
          <p className="onb-lead">{lead}</p>
        </div>
        {children}
        <div className="onb-foot">{footer}</div>
      </CardBody>
    </Card>
  );
}

function Feature({ children }: { children: ReactNode }) {
  return (
    <li>
      <Icon icon={Check} size="sm" />
      <span>{children}</span>
    </li>
  );
}

/** Step 2 on a team's Bridge: the repository as GitHub sees it for this viewer, with the one action it needs. */
function HostedRepo({ ctx, step }: { ctx: OnboardingContext; step: Step }) {
  const { copied, said, copy } = useCopy(3000);
  const access = ctx.hosted?.access ?? null;
  const connected = step.state === 'done';
  return (
    <section className="onb-way" aria-labelledby="onb-way-repo" data-selected={connected ? '' : undefined}>
      <p className="onb-way-tags">
        <Badge tone={connected ? 'success' : access === 'not-installed' ? 'warning' : 'neutral'} size="sm" dot>
          {step.status}
        </Badge>
      </p>
      <h3 id="onb-way-repo" className="onb-h3">
        The repository
      </h3>
      <p className="onb-repo">
        <span className="mono">{ctx.repo}</span>
      </p>
      {access === 'not-installed' ? (
        ctx.hosted?.admin ? (
          <>
            <p className="onb-quiet">Bridge is not set up on it yet. Install it once, for the whole team. GitHub asks which repositories it may read.</p>
            <p>
              <ButtonLink variant="primary" href={installUrl()} target="_blank" rel="noopener noreferrer">
                Install Bridge
              </ButtonLink>
            </p>
          </>
        ) : (
          <>
            <p className="onb-quiet">Bridge is not set up on it yet. An admin of the repository installs it once, for the whole team.</p>
            <p>
              <Button variant="secondary" iconStart={copied ? Check : Copy} onClick={() => void copy(askInstallMessage(ctx.repo, ctx.team.link), 'Message copied. Paste it to an admin.')}>
                {copied ? 'Message copied' : 'Ask an admin to install Bridge'}
              </Button>
            </p>
            <p className="sr-only" role="status" aria-live="polite">
              {said}
            </p>
          </>
        )
      ) : (
        <>
          <p className="onb-quiet">{access === 'outside-contributor' ? 'You are not on this team on GitHub: you can look around and send suggestions.' : ctx.storybook ? 'Everything in your Storybook, plus' : 'Bridge reads from it'}</p>
          {connected && access !== 'outside-contributor' && (
            <ul className="onb-features">
              <Feature>Tokens and contrast checks</Feature>
              <Feature>The Figma fidelity check</Feature>
              <Feature>Adoption across your products</Feature>
              <Feature>Tracking what explorations change</Feature>
            </ul>
          )}
        </>
      )}
      <p className="onb-quiet">
        Not this one? <Link href={STUDIO_ROOT}>Create a new team</Link>
      </p>
    </section>
  );
}

/** Step 2 of the browser workspace: the repository, picked by name. It opens that team at its next step. */
function WorkspaceRepo({ connectGitHub, linkRepo }: { connectGitHub?: () => void; linkRepo?: (owner: string, repo: string) => Promise<string | null> }) {
  // "Create your team" without GitHub on this browser: GitHub comes in here, only to link the repository.
  if (connectGitHub)
    return (
      <section className="onb-way" aria-labelledby="onb-way-repo">
        <p className="onb-way-tags">
          <Badge size="sm">Read only</Badge>
          <span className="onb-quiet">Now or later</span>
        </p>
        <h3 id="onb-way-repo" className="onb-h3">
          Connect the repository
        </h3>
        <p className="onb-quiet">{ENTRY_WORDS.connectGitHubWhy}</p>
        <p>
          <Button variant="secondary" onClick={connectGitHub}>
            {ENTRY_WORDS.connectGitHub}
          </Button>
        </p>
      </section>
    );
  return (
    <section className="onb-way" aria-labelledby="onb-way-repo">
      <p className="onb-way-tags">
        <Badge size="sm">Read only</Badge>
        <span className="onb-quiet">Now or later</span>
      </p>
      <h3 id="onb-way-repo" className="onb-h3">
        Connect the repository
      </h3>
      <p className="onb-quiet">Bridge reads the code your design system is built from. Your team opens it with the same link.</p>
      <TeamField id="onb-team-repo" action="Open" variant="secondary" query={`?setup=${NEXT_AFTER_LIBRARY}`} before={linkRepo} />
      <div className="onb-get">
        <p className="onb-quiet">Everything in Storybook, plus</p>
        <ul className="onb-features">
          <Feature>Tokens and contrast checks</Feature>
          <Feature>The Figma fidelity check</Feature>
          <Feature>Adoption across your products</Feature>
          <Feature>Tracking what explorations change</Feature>
        </ul>
      </div>
    </section>
  );
}

/** Step 2: the Storybook quick start and the repository this Studio reads. */
function LibraryStep({ ctx, step, actions }: { ctx: OnboardingContext; step: Step; actions: OnboardingActions }) {
  return (
    <div className="onb-ways">
      <section className="onb-way" aria-labelledby="onb-way-sb" data-selected={ctx.quickStart ? '' : undefined}>
        <p className="onb-way-tags">
          {ctx.quickStart ? (
            <Badge tone="success" size="sm" dot>
              Added
            </Badge>
          ) : (
            <Badge size="sm">
              Quick start
            </Badge>
          )}
          <span className="onb-quiet">About 2 minutes</span>
        </p>
        <h3 id="onb-way-sb" className="onb-h3">
          Paste your Storybook URL
        </h3>
        <p className="onb-quiet">See your components in Bridge in about 2 minutes, without the repository.</p>
        <StorybookField saved={ctx.quickStart ?? null} variant="secondary" id="onb-sb-url" />
        <div className="onb-get">
          <p className="onb-quiet">You get</p>
          <ul className="onb-features">
            <Feature>Your components in Bridge, with their stories</Feature>
            <Feature>A live preview of every story</Feature>
          </ul>
        </div>
      </section>
      {ctx.workspace ? (
        <WorkspaceRepo connectGitHub={ctx.account && !ctx.account.github ? actions.connectGitHub : undefined} linkRepo={actions.linkRepo} />
      ) : ctx.hosted ? (
        <HostedRepo ctx={ctx} step={step} />
      ) : (
      <section className="onb-way" aria-labelledby="onb-way-repo" data-selected="">
        <p className="onb-way-tags">
          <Badge tone="success" size="sm" dot>
            Connected
          </Badge>
        </p>
        <h3 id="onb-way-repo" className="onb-h3">
          The repository
        </h3>
        <p className="onb-repo">
          <span className="mono">{ctx.repo}</span>
          <Link href={ctx.repoUrl} external>
            {VOCAB.openOnGitHub}
          </Link>
        </p>
        <p className="onb-quiet">{ctx.storybook ? 'Everything in your Storybook, plus' : 'Bridge reads from it'}</p>
        <ul className="onb-features">
          <Feature>Tokens and contrast checks</Feature>
          <Feature>The Figma fidelity check</Feature>
          <Feature>Adoption across your products</Feature>
          <Feature>Tracking what explorations change</Feature>
        </ul>
      </section>
      )}
    </div>
  );
}

export interface OnboardingProps {
  steps: Step[];
  /** The viewer's first name, for the title. */
  name: string | null;
  /** The step to open first; the current one when absent. */
  initial?: StepId;
  ctx: OnboardingContext;
  actions: OnboardingActions;
}

export function Onboarding({ steps, name, initial, ctx, actions }: OnboardingProps) {
  const first = initial ?? steps.find((s) => s.state === 'current')?.id ?? steps.find((s) => s.state !== 'done')?.id ?? 'signin';
  const [open, setOpen] = useState<StepId>(first);
  const [mode, setMode] = useState<ChangesMode>('suggest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ number: number; url: string } | null>(null);
  const [teamName, setTeamName] = useState(() => ctx.suggestedName?.trim() || humanizeRepo(ctx.repo));
  // "Create your team" (E6): the name, prefilled from the work domain, and "find this team", checked for a work email.
  const [newName, setNewName] = useState(() => ctx.account?.teamName ?? teamNameFromDomain(ctx.account?.domain ?? null));
  const [discover, setDiscover] = useState(ctx.account?.discover ?? true);
  const [creating, setCreating] = useState(false);
  const [named, setNamed] = useState<{ number: number; url: string; name: string } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const step = steps.find((s) => s.id === open) ?? steps[0]!;
  const total = steps.length;
  const { onOpen } = actions;
  useEffect(() => onOpen?.(open), [open, onOpen]);
  // Another step opened (not the first paint): focus goes to its title, and an address with ?setup= follows it, so a
  // reload opens the same step.
  const shown = useRef(open);
  useEffect(() => {
    if (shown.current === open) return;
    shown.current = open;
    document.getElementById('onb-panel-title')?.focus();
    if (new URLSearchParams(location.search).has('setup')) history.replaceState(history.state, '', `${location.pathname}${withSetupStep(location.search, open)}${location.hash}`);
  }, [open]);
  const narrow = useNarrow();
  const next = () => {
    const i = steps.findIndex((s) => s.id === open);
    const after = steps.slice(i + 1).find((s) => s.state !== 'done') ?? steps[i + 1];
    if (after) setOpen(after.id);
    else actions.later(open);
  };
  const back = () => {
    const i = steps.findIndex((s) => s.id === open);
    if (i > 0) setOpen(steps[i - 1]!.id);
  };
  const later = (
    <Button variant="ghost" onClick={() => actions.later(open)}>
      Do this later
    </Button>
  );
  const backLink =
    step.n > 1 ? (
      <Button variant="link" onClick={back} className="onb-back">
        Back
      </Button>
    ) : (
      <span />
    );
  const nav = (primary: ReactNode = <Button onClick={next}>Continue</Button>) => (
    <>
      {backLink}
      <span className="onb-foot-end">
        {later}
        {primary}
      </span>
    </>
  );

  // The browser workspace: a step that needs the repository says so, and leads back to step 2.
  const needsRepo = (lead: string) => (
    <Panel step={step} total={total} title={STEP_TITLE[open]} lead={lead} footer={nav(<Button variant="secondary" onClick={next}>Continue</Button>)}>
      <p className="onb-quiet">This comes with the repository. Connect it on step 2 first.</p>
      <p>
        <Button variant="primary" onClick={() => setOpen('library')}>
          Connect the repository
        </Button>
      </p>
    </Panel>
  );

  let panel: ReactNode;
  switch (open) {
    case 'create': {
      const domain = ctx.account?.domain ?? null;
      const save = async () => {
        const problem = teamNameProblem(newName);
        if (problem) return setNameError(problem);
        setNameError(null);
        setCreating(true);
        try {
          // The team exists once the server says so: only then is "Your team" done and the next step open.
          await actions.createTeam?.(newName.trim().replace(/\s+/g, ' '), Boolean(domain) && discover);
          next();
        } catch (err) {
          setNameError(err instanceof Error && err.message ? err.message : ENTRY_WORDS.createFailed);
        } finally {
          setCreating(false);
        }
      };
      panel = (
        <Panel
          step={step}
          total={total}
          title={ENTRY_WORDS.createTitle}
          lead={ENTRY_WORDS.createLead}
          footer={
            <>
              <Link href={DEMO_HOME} className="onb-demo">
                {ENTRY_WORDS.noDesignSystem}
              </Link>
              <span className="onb-foot-end">
                <span className="onb-quiet">{ENTRY_WORDS.nextLibrary}</span>
                <Button type="submit" form="onb-create-form" loading={creating} disabled={creating}>
                  Continue
                </Button>
              </span>
            </>
          }
        >
          <form
            id="onb-create-form"
            className="onb-name"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input
              id="onb-new-team"
              className="onb-field"
              label={ENTRY_WORDS.teamName}
              hint={domain ? undefined : ENTRY_WORDS.inviteOnly}
              value={newName}
              maxLength={60}
              autoComplete="organization"
              error={nameError ?? undefined}
              onValueChange={(v: string) => {
                setNewName(v);
                setNameError(null);
              }}
            />
            {domain && <Checkbox label={ENTRY_WORDS.findable(domain)} description={ENTRY_WORDS.findableHelp} checked={discover} onCheckedChange={setDiscover} />}
          </form>
        </Panel>
      );
      break;
    }
    case 'signin':
      panel = (
        <Panel
          step={step}
          total={total}
          title={ctx.signIn?.href && step.state !== 'done' ? 'Sign in' : 'Sign in with GitHub'}
          lead={step.state === 'done' ? `${step.detail}. Your sign-in stays in this browser.` : ctx.signIn?.href ? 'Use your work email. Bridge keeps your setup with your account.' : 'Bridge works as you on GitHub.'}
          footer={
            step.state !== 'done' && ctx.signIn
              ? nav(
                  ctx.signIn.href ? (
                    <ButtonLink variant="primary" href={ctx.signIn.href}>
                      Sign in
                    </ButtonLink>
                  ) : (
                    // The shared session listens for these attributes (scripts/github-session.ts): sign in, or the dialog.
                    <Button data-gh-open="" data-gh-signin={ctx.signIn.direct ? '' : undefined}>
                      {ctx.signIn.button}
                    </Button>
                  ),
                )
              : nav()
          }
        />
      );
      break;
    case 'library': {
      // Installing Bridge is this step's one primary action; Continue steps back.
      const install = ctx.hosted?.access === 'not-installed' && ctx.hosted.admin;
      panel = (
        <Panel
          step={step}
          total={total}
          title="Connect your design system"
          lead="Two ways in. Storybook is the quick start; the repository unlocks the checks."
          footer={nav(install ? <Button variant="secondary" onClick={next}>Continue</Button> : undefined)}
        >
          <LibraryStep ctx={ctx} step={step} actions={actions} />
        </Panel>
      );
      break;
    }
    case 'name': {
      const done = step.state === 'done';
      const waiting = Boolean(named) || step.state === 'waiting';
      const save = async () => {
        const problem = teamNameProblem(teamName);
        if (problem) return setNameError(problem);
        if (!actions.name) return;
        setBusy(true);
        setNameError(null);
        try {
          const pr = await actions.name(teamName);
          setNamed({ ...pr, name: teamName.trim() });
        } catch (err) {
          setNameError((err as Error).message);
        } finally {
          setBusy(false);
        }
      };
      panel = (
        <Panel
          step={step}
          total={total}
          title={TEAM_NAME_WORDS.stepTitle}
          lead={TEAM_NAME_WORDS.lead}
          footer={
            done || waiting || !actions.name
              ? nav()
              : nav(
                  <Button type="submit" form="onb-name-form" loading={busy} disabled={busy}>
                    {TEAM_NAME_WORDS.save}
                  </Button>,
                )
          }
        >
          {done ? (
            <p className="onb-done">
              <Icon icon={Check} size="sm" />
              <span>
                Your team is <b className="onb-strong">{step.detail}</b>. <Link href={studioHref('settings/#general')}>Change it in Settings</Link>
              </span>
            </p>
          ) : waiting ? (
            <div className="rq-done" role="status">
              <p>
                <strong>
                  {TEAM_NAME_WORDS.requested}
                  {named ? `, #${named.number}` : ''}.
                </strong>{' '}
                {named ? named.name : step.detail}. {TEAM_NAME_WORDS.applies}
              </p>
              <p>
                <Link href={studioHref(`changes/?pr=${named?.number ?? step.pr ?? ''}`)}>See the branch</Link>
              </p>
            </div>
          ) : (
            <form
              id="onb-name-form"
              className="onb-name"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Input
                id="onb-team-name"
                label={TEAM_NAME_WORDS.label}
                hint={TEAM_NAME_WORDS.help}
                value={teamName}
                maxLength={60}
                autoComplete="off"
                error={nameError ?? undefined}
                onValueChange={(v: string) => {
                  setTeamName(v);
                  setNameError(null);
                }}
              />
            </form>
          )}
        </Panel>
      );
      break;
    }
    case 'team':
      panel = (
        // Copy link is this step's one primary action; Continue steps back.
        <Panel step={step} total={total} title={STEP_TITLE.team} lead={STEP_LINE.team} footer={nav(<Button variant="secondary" onClick={next}>Continue</Button>)}>
          <TeamLink
            id="onb-team-link"
            owner={ctx.team.owner}
            repo={ctx.team.repo}
            link={ctx.team.link}
            access={ctx.team.access}
            changes={ctx.team.changes}
            owners={ctx.team.owners}
            onCopied={() => actions.mark('team')}
          />
        </Panel>
      );
      break;
    case 'products':
      if (ctx.workspace) {
        panel = needsRepo("The apps that use your library, found in the repository's Bridge settings.");
        break;
      }
      panel = (
        <Panel step={step} total={total} title="Products" lead="The apps that use your library, found in the repository's Bridge settings." footer={nav()}>
          {ctx.products.length ? (
            <ul className="onb-list">
              {ctx.products.map((p) => (
                <li key={p.name}>
                  <span className="onb-strong">{p.name}</span>
                  {p.path && <span className="mono onb-quiet">{p.path}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="onb-quiet">No product is listed yet. Add them to bridge.config.json under products.</p>
          )}
        </Panel>
      );
      break;
    case 'changes': {
      if (ctx.workspace) {
        panel = needsRepo('When your team keeps an exploration, Bridge hands the change to your developers. You pick how once the repository is connected.');
        break;
      }
      const chosen = step.state === 'done';
      panel = (
        <Panel
          step={step}
          total={total}
          title="How changes reach your code"
          lead="When your team keeps an exploration, Bridge hands the change to your developers. Pick how."
          footer={
            sent || chosen || step.state === 'waiting'
              ? nav()
              : nav(
                  <Button
                    loading={busy}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        setSent(await actions.propose(mode));
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Continue
                  </Button>,
                )
          }
        >
          {chosen ? (
            <p className="onb-done">
              <Icon icon={Check} size="sm" />
              <span>
                Chosen: <b className="onb-strong">{step.detail}</b>. <Link href={studioHref('settings/#changes')}>Change it in Settings</Link>
              </span>
            </p>
          ) : sent || step.state === 'waiting' ? (
            <div className="rq-done" role="status">
              <p>
                <strong>Sent for review{sent ? `, #${sent.number}` : ''}.</strong> {sent ? CHANGES_CHOICE[mode].title : step.detail}. It applies once your team approves and merges the branch.
              </p>
              <p>
                <Link href={studioHref(`changes/?pr=${sent?.number ?? step.pr ?? ''}`)}>See the branch</Link>
              </p>
            </div>
          ) : (
            <>
              <ChangesChoices value={mode} onChange={setMode} />
              {mode === 'suggest' && <DevelopersGet repo={ctx.repo} />}
              <p className="onb-quiet">Change this later in Settings. Continue asks your team to review the choice.</p>
              {error && (
                <p className="rq-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </Panel>
      );
      break;
    }
    case 'figma':
    case 'claude': {
      const figma = open === 'figma';
      if (!figma && ctx.workspace) {
        panel = needsRepo('Your own Claude gets Bridge tools on your design system, and can apply suggestions in the repo.');
        break;
      }
      const done = step.state === 'done';
      panel = (
        <Panel
          step={step}
          total={total}
          title={STEP_TITLE[open]}
          lead={figma ? 'The plugin brings your tokens into Figma Variables and sends your variable edits for review.' : 'Your own Claude gets Bridge tools on this design system, and can apply suggestions in the repo.'}
          footer={nav(
            done ? (
              <Button onClick={next}>Continue</Button>
            ) : (
              <Button
                onClick={() => {
                  actions.mark(open);
                  next();
                }}
              >
                Mark as done
              </Button>
            ),
          )}
        >
          {figma ? (
            <p>
              <ButtonLink variant="secondary" href={ctx.figmaHref}>
                Install the plugin
              </ButtonLink>
            </p>
          ) : (
            <>
              <CodeBlock code={ctx.mcpCommand} label="Add Bridge to Claude Code once" />
              <p className="onb-quiet">
                Then ask it to <q>Apply Bridge suggestion</q> with the issue number, or anything about the library. <Link href={ctx.claudeHref}>Other Claude apps</Link>
              </p>
            </>
          )}
        </Panel>
      );
      break;
    }
  }

  const progress = (
    <div className="onb-progress">
      <p className="onb-progress-text">
        <b className="onb-strong">{progressLabel(steps)}</b> <span className="onb-quiet">{ctx.account ? ENTRY_WORDS.firstOnly : 'Every step after sign-in can wait.'}</span>
      </p>
      <Progress value={doneCount(steps)} max={total} size="sm" aria-label={progressLabel(steps)} />
    </div>
  );
  // The open step comes first in the page (and first on a phone); the checklist follows it, folded on a phone.
  return (
    <div className="onb">
      <div className="onb-head">
        <Drawing name="hero" width={126} className="onb-art" />
        <h1 id="onb-title" className="onb-h1">
          {ctx.account ? ENTRY_WORDS.setupTitle(name, ctx.account.teamName) : firstRunTitle(name, open === 'changes' ? 'changes' : 'library')}
        </h1>
      </div>
      <div className="onb-main">{panel}</div>
      <aside className="onb-side" aria-label="Setup checklist">
        {narrow ? (
          <Accordion headingLevel={2}>
            <AccordionItem value="steps" title="All setup steps" meta={progressLabel(steps)}>
              <StepList steps={steps} open={open} onOpen={setOpen} />
            </AccordionItem>
          </Accordion>
        ) : (
          <>
            {progress}
            <StepList steps={steps} open={open} onOpen={setOpen} />
          </>
        )}
        {/* Only before a team exists: an admin of one is not waiting for an invite. */}
        {ctx.account && !ctx.account.teamName && (
          <p className="onb-quiet onb-expecting">
            {ENTRY_WORDS.expecting} <b className="onb-strong">{ctx.account.email}</b>
          </p>
        )}
      </aside>
    </div>
  );
}

/** Below the two-column width (onboarding.css), the checklist folds under the open step. */
const NARROW = '(max-width: 1099px)';

function useNarrow(): boolean {
  const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null);
  const [narrow, setNarrow] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export interface FinishConnectingProps {
  steps: Step[];
  /** Opens the steps at one of them. */
  onOpen: (id: StepId) => void;
  onHide: () => void;
  /** Offer "Hide checklist" (default). The browser workspace keeps it: it is the way back into the steps. */
  hideable?: boolean;
  /** The line under the title; the browser workspace says what to connect first. */
  description?: string;
}

/** The link word of a step left in the checklist. */
const actionWord = (s: Step) => (s.state === 'waiting' ? 'See' : s.id === 'changes' ? 'Choose' : s.id === 'team' ? 'Invite' : s.id === 'name' ? 'Name' : 'Set up');

/** "4 of 8 connected": the steps left, behind one button on the home. */
export function FinishConnecting({ steps, onOpen, onHide, hideable = true, description = 'Your workspace already works. These add more, whenever you like.' }: FinishConnectingProps) {
  const left = steps.filter((s) => s.state !== 'done');
  const summary = doneSummary(steps);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="secondary" iconEnd={ChevronDown} className="onb-trigger" />}>
        <Progress variant="circular" size="sm" value={doneCount(steps)} max={steps.length} aria-hidden="true" />
        {progressLabel(steps)}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" arrow={false} title="Finish connecting" description={description} className="onb-pop">
        <Progress value={doneCount(steps)} max={steps.length} size="sm" aria-label={progressLabel(steps)} />
        <ul className="onb-pop-list">
          {summary && (
            <li className="onb-pop-row">
              <span className="onb-mark" data-state="done" aria-hidden="true">
                <Icon icon={Check} size="xs" />
              </span>
              <span className="onb-step-detail">{summary}</span>
            </li>
          )}
          {left.map((s) => (
            <li key={s.id} className="onb-pop-row">
              <StepMark s={s} />
              <StepText s={s} />
              <Button variant="link" onClick={() => onOpen(s.id)} aria-label={`${actionWord(s)}: ${s.title}`}>
                {actionWord(s)}
              </Button>
            </li>
          ))}
        </ul>
        {hideable && (
          <div className="onb-pop-foot">
            <Button variant="ghost" size="sm" onClick={onHide}>
              Hide checklist
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A team's Bridge (hosted): the steps on the team's home, opened with ?setup=<step>

/** The step asked for in the address (?setup=team), null for none or an unknown one. */
export function setupStepFromUrl(search: string): StepId | null {
  const asked = new URLSearchParams(search).get('setup');
  return asked && (STEP_IDS as readonly string[]).includes(asked) ? (asked as StepId) : null;
}

export interface HostedOnboardingProps {
  gate: { owner: string; repo: string; login: string | null; access: RepoAccessState | null; repoAdmin: boolean };
  /** The team link. */
  link: string;
  initial: StepId;
  /** Leaves the steps for the page. */
  onLeave: () => void;
}

/**
 * The onboarding of a team's Bridge, with what this browser remembers of that repository
 * (bridge.onboarding.<owner>/<repo>) and the team's settings once read (scripts/repo-context.ts siteConfig).
 */
export function HostedOnboarding({ gate, link, initial, onLeave }: HostedOnboardingProps) {
  const repo = `${gate.owner}/${gate.repo}`;
  const key = onboardingKey(repo);
  const load = (): OnboardingMemory => {
    try {
      return parseMemory(readMemoryText(localStorage, repo, null));
    } catch {
      return parseMemory(null);
    }
  };
  const [memory, setMemory] = useState<OnboardingMemory>(load);
  const save = (next: OnboardingMemory) => {
    setMemory(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode: kept for this visit only */
    }
  };
  const [cfg, setCfg] = useState<{ name: string | null; changes: ChangesMode | null; owners?: { design: string[]; tech: string[] }; products: { name: string; path?: string }[]; storybook: string | null }>({
    name: null,
    changes: null,
    products: [],
    storybook: null,
  });
  useEffect(() => {
    let live = true;
    const read = () =>
      void import('../../../scripts/repo-context').then(({ siteConfig }) => {
        if (!live) return;
        const c = siteConfig();
        setCfg({
          name: c.name ?? null,
          changes: c.changes ?? null,
          owners: c.owners,
          products: (c.products ?? []).map((p) => ({ name: p.name, path: p.path })),
          storybook: null,
        });
      });
    read();
    document.addEventListener('bridge:team-model', read);
    return () => {
      live = false;
      document.removeEventListener('bridge:team-model', read);
    };
  }, []);

  const admin = gate.access === 'admin' || gate.repoAdmin;
  // "Create your team" (E6) picked this repository on step 2 while Bridge was not installed on it: now that its admin
  // is here, the team made in Bridge moves to it (members, requests, discovery, name). Once.
  const [pendingLink] = useState<PendingLink | null>(() => {
    const l = readStart().link;
    return l && l.repo === repo.toLowerCase() ? l : null;
  });
  useEffect(() => {
    if (!admin || !pendingLink) return;
    void (async () => {
      const api = await import('../../../scripts/entry-session');
      try {
        await api.linkRepo(pendingLink.team, pendingLink.repo);
        rememberStart({ link: null });
      } catch (err) {
        // Still not installed: tried again on the next visit. Anything else (not their team any more): forgotten.
        if (!(err instanceof api.EntryError && (err.code === 'app_missing' || err.code === 'not_configured'))) rememberStart({ link: null });
      }
    })();
  }, [admin, pendingLink]);
  // The name the team was given in Bridge (kept with the team once linked) prefills "Name your team".
  const [given] = useState<string | null>(() => knownTeamName(repo));
  const steps = onboardingSteps({
    login: gate.login,
    repo,
    storybook: cfg.storybook,
    products: cfg.products.map((p) => p.name),
    changes: cfg.changes,
    proposed: cfg.changes ? null : memory.proposed,
    teamName: cfg.name,
    named: cfg.name ? null : memory.named,
    marked: memory.marked,
    hosted: { access: gate.access, admin },
  });
  return (
    <Onboarding
      steps={steps}
      name={gate.login}
      initial={initial}
      ctx={{
        repo,
        repoUrl: `https://github.com/${repo}`,
        storybook: cfg.storybook,
        products: cfg.products,
        mcpCommand: bridgeMcpInstallCommand(repo),
        figmaHref: '/install/#figma-plugin',
        claudeHref: '/agents/#claude-code',
        team: { owner: gate.owner, repo: gate.repo, link, access: gate.access, changes: cfg.changes, owners: cfg.owners },
        hosted: { access: gate.access, admin },
        suggestedName: given,
      }}
      actions={{
        propose: async (mode) => {
          const { proposeChangesMode } = await import('../../../scripts/roles');
          const pr = await proposeChangesMode(mode);
          save({ ...memory, proposed: { pr: pr.number, mode } });
          return pr;
        },
        name: async (name) => {
          const { proposeTeamName } = await import('../../../scripts/roles');
          const pr = await proposeTeamName(name);
          save({ ...memory, named: { pr: pr.number, name: name.trim() } });
          return pr;
        },
        mark: (id) => save({ ...memory, marked: [...new Set([...memory.marked, id])] }),
        later: onLeave,
      }}
    />
  );
}
