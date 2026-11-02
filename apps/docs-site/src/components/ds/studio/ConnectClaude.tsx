// /studio/connect-claude/?request=…: where Claude sends the person when they add the Bridge connector (api/mcp,
// api/_lib/oauth.ts). A standalone card: no team, no demo, no Studio nav. One read (GET /oauth/request) says where they
// are; then:
//   signed out   Sign in, which comes back to this same request on its own (?next=), and Cancel
//   no team      "Your Bridge account isn't in a team with a design system yet.", Create your team, ask an admin for an
//                invite, Use another account, Cancel
//   one team     it is preselected; several: a picker
//   then         who Claude will act as (avatar, "You're connecting Claude as Dino (Can edit, signed in with email).",
//                Use another account), what Claude gets (read the design system, open changes for review in your name),
//                Allow and Cancel.
// Allow goes to GitHub (it confirms who they are), then back to Claude; Cancel goes back to Claude with access_denied.
// Someone on the team by their email with no GitHub sign-in here allows with their Bridge sign-in alone (no GitHub
// leg); the other path stays one quiet link away (connectPath).
// No token is ever shown. Steps and words: lib/connect-claude.ts.
import { useEffect, useState } from 'react';
import { Alert, Avatar, Button, Icon, Radio, RadioGroup, Spinner } from '@bridge-ds/react';
import { Check } from 'lucide-react';
import { signInHref } from '../../../lib/account';
import { CREATE_TEAM_HREF } from '../../../lib/entry';
import { appName, CLAUDE_CONNECT_WORDS as W, connectClaudeStep, connectPath, identityLine, parseRequestInfo, readQuery, type ClaudeConnectStep, type RequestInfo } from '../../../lib/connect-claude';

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
  const [hasGitHub, setHasGitHub] = useState(false);
  // The GitHub account the GitHub path would connect (GitHub confirms it on Allow), and its role on each team.
  const [ghUser, setGhUser] = useState<{ login: string; name: string; avatar: string | null } | null>(null);
  const [ghRoles, setGhRoles] = useState<Record<string, string>>({});
  const [switched, setSwitched] = useState(false);
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
        if (live) setHasGitHub(Boolean(token));
        const byEmail = new Map(info.teams.filter((t) => t.email).map((t) => [t.repo.toLowerCase(), t.role ?? 'edit'] as const));
        const teams = await loadPickableTeams({ teams: info.teams.map((t) => ({ ...t, role: t.role ?? 'edit', via: 'email' })) }, token).catch(() => info!.teams);
        info = { ...info, teams: teams.map((t) => ({ repo: t.repo, name: t.name, ...(byEmail.has(t.repo.toLowerCase()) ? { email: true, role: byEmail.get(t.repo.toLowerCase())! } : {}) })) };
        if (token) {
          // Who GitHub will confirm on Allow, and that account's role on each team: said before Allow, never guessed.
          const { githubRole } = await import('../../../scripts/pickable-teams');
          const me = await fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } })
            .then((r) => (r.ok ? (r.json() as Promise<{ login?: string; name?: string | null; avatar_url?: string }>) : null))
            .catch(() => null);
          const roles = await Promise.all(info.teams.map(async (t) => [t.repo, await githubRole(token, t.repo).catch(() => null)] as const));
          if (live && me?.login) setGhUser({ login: me.login, name: me.name?.trim() || me.login, avatar: me.avatar_url ?? null });
          if (live) setGhRoles(Object.fromEntries(roles.filter((r): r is readonly [string, string] => Boolean(r[1]))));
        }
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

  async function answer(allow: boolean, via: 'email' | 'github' = 'github') {
    if (!q.request) return;
    setBusy(allow ? 'allow' : 'cancel');
    setError(null);
    try {
      const res = await fetch('/oauth/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: q.request, allow, ...(allow ? { repo: team, ...(via === 'email' ? { via } : {}) } : {}) }),
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
    case 'pick': {
      const picked = step.teams.find((t) => t.repo === team);
      const { path: first, other } = connectPath(picked, hasGitHub);
      const path = switched && other ? other : first;
      // Who Claude will act as, said first: on the GitHub path the GitHub account, on the email path the Bridge account.
      const who =
        path === 'github' && ghUser
          ? { name: ghUser.name, avatar: ghUser.avatar, seed: ghUser.login, role: ghRoles[team] ?? null, sub: W.identityGitHub(ghUser.login) }
          : { name: step.info.name ?? 'You', avatar: null, seed: step.info.name ?? 'you', role: path === 'email' ? (picked?.role ?? null) : (ghRoles[team] ?? null), sub: path === 'email' && step.info.email ? W.identityEmail(step.info.email) : null };
      return (
        <div className="cc-step">
          <p className="cc-lede">{W.lede(appName(step.info))}</p>
          <div className="cc-who" data-connect-identity="">
            <Avatar name={who.name} {...(who.avatar ? { src: who.avatar } : {})} seed={who.seed} size="lg" decorative />
            <div className="cc-who-text">
              <p className="cc-who-line">{identityLine({ name: who.name, role: who.role, via: path })}</p>
              <p className="t-ui t-muted">
                {who.sub ? `${who.sub} ` : ''}
                <Button variant="link" onClick={() => void otherAccount()}>
                  {W.otherAccount}
                </Button>
              </p>
            </div>
          </div>
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
          <p className="t-ui t-muted">
            {path === 'email' ? W.backEmail(step.info.redirectHost) : W.back(step.info.redirectHost)}
            {other && (
              <>
                {' '}
                <Button variant="link" onClick={() => setSwitched((v) => !v)}>
                  {path === 'email' ? W.useGitHub : W.useEmail}
                </Button>
              </>
            )}
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="cc-actions">
            <Button variant="primary" onClick={() => void answer(true, path)} disabled={busy !== null}>
              {busy === 'allow' ? (path === 'email' ? W.allowingEmail : W.allowing) : W.allow}
            </Button>
            {cancel}
          </div>
        </div>
      );
    }
  }
}
