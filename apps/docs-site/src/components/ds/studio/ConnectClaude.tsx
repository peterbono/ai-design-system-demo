// /studio/connect-claude/?request=…: where Claude sends the person when they add the Bridge connector (api/mcp,
// api/_lib/oauth.ts). A standalone card: no team, no demo, no Studio nav. One read (GET /oauth/request) says where they
// are; then:
//   signed out   Sign in, which comes back to this same request on its own (?next=), and Cancel
//   no team      "Your Bridge account isn't in a team with a design system yet.", Create your team, ask an admin for an
//                invite, Use another account, Cancel
//   one team     it is preselected; several: a picker
//   then         what Claude gets (read the design system, open changes for review in your name), Allow and Cancel.
// Allow goes to GitHub (it confirms who they are), then back to Claude; Cancel goes back to Claude with access_denied.
// No token is ever shown. Steps and words: lib/connect-claude.ts.
import { useEffect, useState } from 'react';
import { Alert, Button, Icon, Radio, RadioGroup, Spinner } from '@bridge-ds/react';
import { Check } from 'lucide-react';
import { signInHref } from '../../../lib/account';
import { CREATE_TEAM_HREF } from '../../../lib/entry';
import { appName, CLAUDE_CONNECT_WORDS as W, connectClaudeStep, parseRequestInfo, readQuery, type ClaudeConnectStep, type RequestInfo } from '../../../lib/connect-claude';

const here = () => location.pathname + location.search;

export async function readRequestInfo(id: string): Promise<RequestInfo | null> {
  const res = await fetch(`/oauth/request?id=${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) return null;
  return parseRequestInfo(await res.json().catch(() => null));
}

export default function ConnectClaude() {
  const [step, setStep] = useState<ClaudeConnectStep | null>(null);
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState<'allow' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = typeof location === 'undefined' ? { request: null, error: null } : readQuery(location.search);

  useEffect(() => {
    let live = true;
    void (async () => {
      let info = q.request ? await readRequestInfo(q.request).catch(() => null) : null;
      // The teams to pick: the same list as the team switcher (the account's, plus the site's own design system when
      // this browser's GitHub sign-in can push to it, plus the teams this browser opened), never the account's alone.
      if (info?.signedIn) {
        const [{ loadPickableTeams }, { workingGitHubToken }] = await Promise.all([import('../../../scripts/pickable-teams'), import('../../../scripts/account-session')]);
        const token = await workingGitHubToken().catch(() => null);
        const teams = await loadPickableTeams({ teams: info.teams.map((t) => ({ ...t, role: 'edit', via: 'email' })) }, token).catch(() => info!.teams);
        info = { ...info, teams: teams.map((t) => ({ repo: t.repo, name: t.name })) };
      }
      if (!live) return;
      const s = connectClaudeStep(q, info);
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
    setBusy(allow ? 'allow' : 'cancel');
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
        setBusy(null);
        return;
      }
      location.assign(body.redirect);
    } catch {
      setError(W.failed);
      setBusy(null);
    }
  }

  async function otherAccount() {
    const { signOut } = await import('../../../scripts/account-session');
    await signOut().catch(() => {});
    location.assign(signInHref(here()));
  }

  const cancel = (
    <Button variant="secondary" onClick={() => void answer(false)} disabled={busy !== null}>
      {busy === 'cancel' ? W.cancelling : W.cancel}
    </Button>
  );

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
        <div className="cc-step">
          <p className="cc-lede">{W.lede(appName(step.info))}</p>
          <p>{W.signin}</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="cc-actions">
            <Button variant="primary" onClick={() => location.assign(signInHref(here()))}>
              {W.signinAction}
            </Button>
            {cancel}
          </div>
        </div>
      );
    case 'no-teams':
      return (
        <div className="cc-step">
          <p className="cc-lede">{W.noTeams}</p>
          {step.info.name && <p className="t-ui t-muted">{W.signedInAs(step.info.name)}</p>}
          <p>{W.askInvite}</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="cc-actions">
            <Button variant="primary" onClick={() => location.assign(CREATE_TEAM_HREF)}>
              {W.createTeam}
            </Button>
            <Button variant="secondary" onClick={() => void otherAccount()}>
              {W.otherAccount}
            </Button>
            {cancel}
          </div>
        </div>
      );
    case 'pick':
      return (
        <div className="cc-step">
          <p className="cc-lede">{W.lede(appName(step.info))}</p>
          {step.teams.length > 1 ? (
            <RadioGroup label={W.teamLabel} value={team} onValueChange={setTeam}>
              {step.teams.map((t) => (
                <Radio key={t.repo} value={t.repo} label={t.name} />
              ))}
            </RadioGroup>
          ) : (
            <p>
              {W.teamLabel}: <strong>{step.teams[0]!.name}</strong>
            </p>
          )}
          <div className="cc-gets">
            <p>{W.gets}</p>
            <ul>
              {[W.canRead, W.canPropose].map((x) => (
                <li key={x}>
                  <Icon icon={Check} size="sm" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
            <p className="t-ui t-muted">{W.approval}</p>
          </div>
          <p className="t-ui t-muted">{W.back(step.info.redirectHost)}</p>
          {step.info.name && (
            <p className="t-ui t-muted">
              {W.signedInAs(step.info.name)}{' '}
              <Button variant="link" onClick={() => void otherAccount()}>
                {W.otherAccount}
              </Button>
            </p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="cc-actions">
            <Button variant="primary" onClick={() => void answer(true)} disabled={busy !== null}>
              {busy === 'allow' ? W.allowing : W.allow}
            </Button>
            {cancel}
          </div>
        </div>
      );
  }
}
