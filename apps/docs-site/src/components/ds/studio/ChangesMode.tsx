// How changes reach your code: the two modes as choice cards, what developers get in suggest mode, and the Settings
// band that shows the mode in force and proposes a switch as a pull request on bridge.config.json (scripts/roles.ts).
// Words come from lib/settings-view.ts, so the onboarding step and Settings say the same thing.
import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { bridgeMcpInstallCommand, type ChangesMode } from '@bridge-ds/core';
import { Alert, Badge, Button, Card, CardBody, ChoiceCard, ChoiceCardGroup, CodeBlock, Icon, Link } from '@bridge-ds/react';
import { appReach, canProposeSettings, GITHUB_WRITE_ONLY, CHANGES_CHOICE, CHANGES_ORDER, CHANGES_PLAIN, effectiveChanges, suggestAppText, type AppReach } from '../../../lib/settings-view';
import type { SignInApp } from '../../../lib/github-signin';
import { ghAction } from '../../../lib/gh-wording';
import { VOCAB } from '../../../lib/vocabulary';
import { currentViewer, getToken, initGitHubConnect, prefersSignIn, type Viewer } from '../../../scripts/github-session';
import { proposeChangesMode, readAppPermissions } from '../../../scripts/roles';
import { studioHref } from '../../../lib/team-path';

function ChoiceText({ mode }: { mode: ChangesMode }) {
  const c = CHANGES_CHOICE[mode];
  return (
    <span className="cm-choice">
      <span>
        {c.lead && <b className="cm-strong">{c.lead} </b>}
        {c.text}
      </span>
      {mode === 'suggest' && (
        <span>
          Developers apply it with <code className="mono">bridge apply</code> or Claude AI.
        </span>
      )}
      <span className="cm-needs">
        <Icon icon={Lock} size="xs" />
        {c.needs}
      </span>
    </span>
  );
}

/** The two modes as choice cards, suggestions first (the default). */
export function ChangesChoices({ value, onChange, label = 'How changes reach your code' }: { value: ChangesMode; onChange: (m: ChangesMode) => void; label?: string }) {
  return (
    <ChoiceCardGroup label={label} hideLabel orientation="vertical" value={value} onValueChange={(v) => onChange(v === 'direct' ? 'direct' : 'suggest')}>
      {CHANGES_ORDER.map((m) => (
        <ChoiceCard
          key={m}
          value={m}
          title={
            <span className="cm-title">
              {CHANGES_CHOICE[m].title}
              {m === 'suggest' && (
                <Badge tone="info" size="sm">
                  Default
                </Badge>
              )}
            </span>
          }
          description={<ChoiceText mode={m} />}
        />
      ))}
    </ChoiceCardGroup>
  );
}

/** "See what your developers get": how a developer applies a suggestion, from the terminal or with Claude Code. */
export function DevelopersGet({ repo }: { repo: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cm-devs">
      <Button variant="link" aria-expanded={open} aria-controls="cm-devs-panel" onClick={() => setOpen(!open)}>
        {open ? 'Hide what your developers get' : 'See what your developers get'}
      </Button>
      <div id="cm-devs-panel" className="cm-devs-panel" hidden={!open}>
        <p className="cm-p">Each suggestion is a GitHub issue with the change, its previews and its checks. Once it is approved, a developer applies it in the design system repo, on a branch of their choice:</p>
        <CodeBlock code="bridge apply <issue number>" label="In the terminal" hideCopy />
        <p className="cm-p">
          Or they ask Claude Code, with the Bridge MCP: <q>Apply Bridge suggestion #&lt;issue number&gt;</q>.
        </p>
        <CodeBlock code={bridgeMcpInstallCommand(repo)} label="First time? Add Bridge to Claude Code once" />
      </div>
    </div>
  );
}

export interface ChangesModeSettingProps {
  /** `changes` as bridge.config.json says it; null when the key is absent (suggestions, the default). */
  set: ChangesMode | null;
  /** owner/repo */
  repo: string;
  prefix?: string;
  protectedBranches?: string[];
  /** The app Studio signs in with in suggest mode (SignInConfig.suggestApp); null without a GitHub App. */
  suggestApp?: SignInApp | null;
}

/** Settings > How changes reach your code: the mode in force, what the GitHub App may do, and the switch. */
export default function ChangesModeSetting({ set, repo, prefix, protectedBranches, suggestApp = null }: ChangesModeSettingProps) {
  const current = effectiveChanges(set);
  // Interim sentence only while suggest mode runs on the write app; the read-only line once Bridge has both apps.
  const appNote = suggestAppText(suggestApp);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<ChangesMode>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: number; url: string } | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [reach, setReach] = useState<AppReach | null>(null);
  /** Kept changes live in the design system's files: only a GitHub account that can edit it proposes a change (BR-20). */
  const [canPropose, setCanPropose] = useState<boolean | null>(null);

  useEffect(() => {
    void import('../../../scripts/github-session').then(({ onAccess }) => onAccess((a) => setCanPropose(canProposeSettings(a))));
    initGitHubConnect((v) => {
      setViewer(v);
      setReach(null);
      if (v) void readAppPermissions().then((p) => setReach(p ? appReach(p) : null));
    });
    setViewer(currentViewer());
  }, []);

  // Read in designer words (board D9); the choice cards say what each mode needs on GitHub.
  const plain = CHANGES_PLAIN[current];
  const cancel = () => {
    setEditing(false);
    setValue(current);
    setError(null);
  };
  const submit = async () => {
    if (value === current && set) return;
    setBusy(true);
    setError(null);
    try {
      const pr = await proposeChangesMode(value, { prefix, protectedBranches });
      setDone(pr);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canSubmit = value !== current || !set;

  return (
    <Card>
      <CardBody>
        <div className="set-rows">
          {!editing ? (
            <div className="set-row">
              <p className="set-row-label" id="cm-card-title">
                Kept changes
              </p>
              <div className="set-row-value">
                <p className="cm-strong">{plain.title}</p>
                <p className="set-row-help">{plain.text}</p>
              </div>
              {canPropose === false ? (
                <p className="set-row-help set-admin-only">{GITHUB_WRITE_ONLY}</p>
              ) : (
                <div className="set-row-action">
                  <Button
                    variant="secondary"
                    data-density="compact"
                    onClick={() => {
                      if (!getToken()) return setError(`${ghAction('change how changes reach your code', prefersSignIn())}.`);
                      setDone(null);
                      setEditing(true);
                    }}
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="cm-edit">
              <p className="set-row-label" id="cm-card-title">
                Kept changes
              </p>
              <ChangesChoices value={value} onChange={setValue} />
              {value === 'suggest' && (
                <>
                  {appNote && (
                    <Alert tone="info" className="cm-interim">
                      {appNote}
                    </Alert>
                  )}
                  <DevelopersGet repo={repo} />
                </>
              )}
            </div>
          )}
          {viewer && reach && (
            <div className="set-row">
              <p className="set-row-label">Bridge's GitHub App</p>
              <p className="set-row-value set-row-span">
                <span>{reach.text}</span>
              </p>
            </div>
          )}
        </div>
        {!editing && current === 'suggest' && appNote && (
          <Alert tone="info" className="cm-interim">
            {appNote}
          </Alert>
        )}
        {editing && (
          <div className="set-savebar">
            <div className="rq-actions">
              <Button variant="primary" onClick={submit} loading={busy} disabled={!canSubmit || busy}>
                {VOCAB.requestReview}
              </Button>
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
              <span className="set-muted">Your team approves it before it applies.</span>
            </div>
          </div>
        )}
        {error && (
          <p className="rq-error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <div className="rq-done" role="status">
            <p>
              <strong>Sent for review.</strong> It applies once your team approves it.
            </p>
            <p>
              <Link href={studioHref(`changes/?pr=${done.number}`)}>See the change</Link> ·{' '}
              <Link href={done.url} external>
                {VOCAB.openOnGitHub}
              </Link>
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
