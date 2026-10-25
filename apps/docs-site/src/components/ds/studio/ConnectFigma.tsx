// /studio/connect-figma/?code=…: the browser half of "Sign in with Bridge" in the Figma plugin (api/plugin-link). The
// person is signed in to Bridge as usual; they pick the team and press Connect Figma. The page hands the one-time code,
// the team and this browser's GitHub sign-in to the server, which checks the sign-in can open that team's design
// system; the plugin, which polls with its own secret, receives them once. No token is ever shown. Steps and words:
// lib/connect-figma.ts.
import { useEffect, useState } from 'react';
import { Alert, Button, Radio, RadioGroup, Spinner } from '@bridge-ds/react';
import { signInHref } from '../../../lib/account';
import type { Account } from '../../../lib/account';
import { CONNECT_WORDS as W, LINK_API, codeFrom, connectStep, teamLabel, type ConnectStep } from '../../../lib/connect-figma';

const here = () => location.pathname + location.search;

/** This browser's GitHub sign-in, renewed first when it is close to expiry, with how long it still lasts. */
async function freshGitHub(): Promise<{ token: string; expiresIn: number | null } | null> {
  const a = await import('../../../scripts/account-session');
  const s = await import('../../../scripts/github-session');
  const { needsRefresh } = await import('../../../lib/github-signin');
  if (needsRefresh(s.readAppSession(), Date.now())) await s.refreshSignIn().catch(() => false);
  const token = await a.workingGitHubToken();
  if (!token) return null;
  const at = s.readAppSession()?.expiresAt ?? null;
  return { token, expiresIn: at ? Math.max(60, Math.floor((at - Date.now()) / 1000)) : null };
}

export default function ConnectFigma() {
  const [step, setStep] = useState<ConnectStep | null>(null);
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const code = typeof location === 'undefined' ? null : codeFrom(location.search);

  useEffect(() => {
    let live = true;
    void (async () => {
      const account: Account | null = await import('../../../scripts/account-session')
        .then(({ getAccount }) => getAccount())
        .then((x) => x.account)
        .catch(() => null);
      const github = account ? await freshGitHub().catch(() => null) : null;
      // The same teams as the team switcher, the site's own design system included (scripts/pickable-teams.ts).
      const teams = account && github ? await import('../../../scripts/pickable-teams').then(({ loadPickableTeams }) => loadPickableTeams(account, github.token)).catch(() => undefined) : undefined;
      if (!live) return;
      const s = connectStep(code, account, Boolean(github), teams);
      setStep(s);
      if (s.kind === 'pick') setTeam(s.teams[0]!.repo);
    })();
    return () => {
      live = false;
    };
  }, [code]);

  async function connect() {
    if (step?.kind !== 'pick' || !code) return;
    const picked = step.teams.find((t) => t.repo === team);
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const github = await freshGitHub();
      if (!github) {
        setStep({ kind: 'github' });
        return;
      }
      const res = await fetch(LINK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', code, repo: picked.repo, token: github.token, expires_in: github.expiresIn ?? undefined, name: picked.name ?? undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(body.message ?? W.failed);
        return;
      }
      setDone(teamLabel(picked));
    } catch {
      setError(W.failed);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Alert tone="success" title={W.doneTitle}>{W.done(done)}</Alert>;
  if (!step) return <Spinner label="Checking your sign-in" />;
  switch (step.kind) {
    case 'no-code':
      return <Alert tone="info">{W.noCode}</Alert>;
    case 'signin':
      return (
        <div className="cf-step">
          <p>{W.signin}</p>
          <Button variant="primary" onClick={() => location.assign(signInHref(here()))}>
            {W.signinAction}
          </Button>
        </div>
      );
    case 'github':
      return (
        <div className="cf-step">
          <p>{W.github}</p>
          <Button variant="primary" onClick={() => void import('../../../scripts/account-session').then(({ linkGitHub }) => linkGitHub(here()))}>
            {W.githubAction}
          </Button>
        </div>
      );
    case 'no-teams':
      return <Alert tone="info">{W.noTeams}</Alert>;
    case 'pick':
      return (
        <div className="cf-step">
          {step.teams.length > 1 ? (
            <RadioGroup label={W.teamLabel} value={team} onValueChange={setTeam}>
              {step.teams.map((t) => (
                <Radio key={t.repo} value={t.repo} label={teamLabel(t)} />
              ))}
            </RadioGroup>
          ) : (
            <p>
              {W.teamLabel}: <strong>{teamLabel(step.teams[0]!)}</strong>
            </p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <Button variant="primary" onClick={() => void connect()} disabled={busy}>
            {busy ? W.connecting : W.connect}
          </Button>
        </div>
      );
  }
}
