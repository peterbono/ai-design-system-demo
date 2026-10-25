// /studio/connect-claude/?request=…: where Claude sends the person when they add the Bridge connector (api/mcp,
// api/_lib/oauth.ts). They are signed in to Bridge as usual, pick the team, and press Allow; GitHub confirms who they
// are next, then they go back to Claude. Cancel goes back to Claude with nothing allowed. No token is ever shown.
// Steps and words: lib/connect-claude.ts.
import { useEffect, useState } from 'react';
import { Alert, Button, Radio, RadioGroup, Spinner } from '@bridge-ds/react';
import { signInHref } from '../../../lib/account';
import type { Account } from '../../../lib/account';
import { appName, CLAUDE_CONNECT_WORDS as W, connectClaudeStep, readQuery, teamLabel, type ClaudeConnectStep, type RequestInfo } from '../../../lib/connect-claude';

const here = () => location.pathname + location.search;

async function requestInfo(id: string): Promise<RequestInfo | null> {
  const res = await fetch(`/oauth/request?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  if (!res.ok) return null;
  const d = (await res.json().catch(() => null)) as Partial<RequestInfo> | null;
  return d && typeof d.client === 'string' && typeof d.redirectHost === 'string' ? { client: d.client, redirectHost: d.redirectHost, sameBrowser: d.sameBrowser === true } : null;
}

export default function ConnectClaude() {
  const [step, setStep] = useState<ClaudeConnectStep | null>(null);
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = typeof location === 'undefined' ? { request: null, error: null } : readQuery(location.search);

  useEffect(() => {
    let live = true;
    void (async () => {
      const info = q.request ? await requestInfo(q.request).catch(() => null) : null;
      const account: Account | null = info
        ? await import('../../../scripts/account-session')
            .then(({ getAccount }) => getAccount())
            .then((x) => x.account)
            .catch(() => null)
        : null;
      if (!live) return;
      const s = connectClaudeStep(q, info, account);
      setStep(s);
      if (s.kind === 'pick') setTeam(s.teams[0]!.repo);
    })();
    return () => {
      live = false;
    };
    // Once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function answer(allow: boolean) {
    if (!q.request) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/oauth/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: q.request, allow, ...(allow ? { repo: team } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { redirect?: string; message?: string };
      if (!res.ok || !body.redirect) {
        setError(body.message ?? W.failed);
        setBusy(false);
        return;
      }
      location.assign(body.redirect);
    } catch {
      setError(W.failed);
      setBusy(false);
    }
  }

  if (!step) return <Spinner label="Checking your sign-in" />;
  switch (step.kind) {
    case 'no-request':
      return <Alert tone="info">{W.noRequest}</Alert>;
    case 'no-access':
      return <Alert tone="warning">{W.noAccess}</Alert>;
    case 'expired':
      return <Alert tone="info">{W.expired}</Alert>;
    case 'other-browser':
      return <Alert tone="warning">{W.otherBrowser}</Alert>;
    case 'signin':
      return (
        <div className="cf-step">
          <p>{W.lede(appName(step.info))}</p>
          <p>{W.signin}</p>
          <Button variant="primary" onClick={() => location.assign(signInHref(here()))}>
            {W.signinAction}
          </Button>
        </div>
      );
    case 'no-teams':
      return <Alert tone="info">{W.noTeams}</Alert>;
    case 'pick':
      return (
        <div className="cf-step">
          <p>
            <strong>{W.lede(appName(step.info))}</strong>
          </p>
          <p>{W.what}</p>
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
          <p className="t-ui t-muted">
            {W.github} {W.back(step.info.redirectHost)}
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="cc-actions">
            <Button variant="primary" onClick={() => void answer(true)} disabled={busy}>
              {busy ? W.allowing : W.allow}
            </Button>
            <Button variant="secondary" onClick={() => void answer(false)} disabled={busy}>
              {W.cancel}
            </Button>
          </div>
        </div>
      );
  }
}
