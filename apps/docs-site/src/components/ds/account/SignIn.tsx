// The one sign-in screen of Bridge (pages/signin.astro), for sign in and sign up alike (boards E1 and E2): one Harbor
// zone with a Field Guide drawing, "Welcome to Bridge", the work email and Send code (the one primary action), then
// the 6-digit code (numeric keyboard, one-time-code autofill, a pasted "123 456" works), with a resend link on a
// cooldown. Email only: GitHub comes back where a repository is linked, and in Settings > Account. A new account
// without a name is asked "Your name" once. Then the person goes to `next` (the page that sent them here, ?next=),
// else Bridge picks the room (lib/entry.ts, GET /api/entry): their team, an invite (E3), a team found by work domain
// (E4, E4b), a team picker (E5), or "Create your team" (E6). Those rooms live in EntryRooms.tsx, in this same zone.
// Signed in already, the screen forwards at once. Back from GitHub (Link GitHub, Connect GitHub to accept), the GitHub
// sign-in links to the account first. A site without accounts keeps Continue with GitHub, its only way in.
// lib/account.ts holds the words and rules, scripts/account-session.ts the calls.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { Alert, Button, Icon, Input, Link } from '@bridge-ds/react';
import { GitHubMark } from '../studio/brand-icons';
import { Drawing } from '../studio/Drawing';
import { ACCOUNT_WORDS as W, codeDigits, GITHUB_PENDING_KEY, CODE_LENGTH, defaultNext, PRIVACY_PAGE, readSignInQuery, RESEND_COOLDOWN, type SignedIn } from '../../../lib/account';
import { routeEntry, type EntryRoute } from '../../../lib/entry';
import { DomainRoom, InviteRoom, PickRoom } from './EntryRooms';
import { isEmail } from '../../../lib/invites';
import { maskEmail } from '../../../lib/library-access';
import { loadRecentTeams } from '../../../lib/recent-teams';
import { DEMO_HOME, START_PAGE } from '../../../lib/start';
import '../../../styles/account.css';

/** Tests replace it. */
export const navigate = { to: (href: string) => location.replace(href) };

type Step = 'loading' | 'start' | 'code' | 'name' | 'room' | 'leaving';

/** The rooms shown on this screen; the others are pages of their own. */
type Room = Exclude<EntryRoute, { to: 'go' } | { to: 'create' }>;

function useCooldown(): [number, () => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, () => setLeft(RESEND_COOLDOWN)];
}

export default function SignIn() {
  const [{ next }] = useState(() => readSignInQuery(location.search));
  const [step, setStep] = useState<Step>('loading');
  const [available, setAvailable] = useState(true);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState<'github' | 'send' | 'verify' | 'name' | null>(null);
  const [said, setSaid] = useState('');
  const [left, startCooldown] = useCooldown();
  const [after, setAfter] = useState<SignedIn | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const verifying = useRef(false);

  const leave = (href: string) => {
    setStep('leaving');
    navigate.to(href);
  };

  /**
   * Picks the room (lib/entry.ts): a team's home or "Create your team" leave this screen; an invite, a team found by
   * work domain or the team picker show here. When /api/entry cannot answer, `fallback`, as before Entry.
   */
  const enter = async (fallback: string) => {
    const api = await import('../../../scripts/entry-session');
    try {
      const r = routeEntry(await api.getEntry(), loadRecentTeams());
      if (r.to === 'go' || r.to === 'create') return leave(r.href);
      setRoom(r);
      setStep('room');
    } catch {
      leave(fallback);
    }
  };

  /** Where a signed-in person goes: the page that sent them here, else the room Bridge picks for them. */
  const go = (r: SignedIn) => {
    if (next) return leave(next);
    void enter(r.created ? r.next || START_PAGE : r.next || defaultNext(r.account, loadRecentTeams()));
  };

  /** A finished sign-in: a new account without a name says it once, then goes on. */
  const done = (r: SignedIn) => {
    setEmail((e) => e || r.account.email);
    if (r.created && !r.account.name) {
      setAfter(r);
      setStep('name');
      return;
    }
    go(r);
  };

  const finishGitHub = async (token: string) => {
    setBusy('github');
    const api = await import('../../../scripts/account-session');
    try {
      done(await api.signInWithGitHub(token));
    } catch (err) {
      // No accounts on this site: the GitHub sign-in alone is the way in, as before.
      if (err instanceof api.AccountUnavailable) return leave(next ?? START_PAGE);
      setAlert(err instanceof Error ? err.message : W.failed);
      setStep('start');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      const api = await import('../../../scripts/account-session');
      // Back from GitHub (Continue with GitHub, or Link GitHub from the account menu): the sign-in becomes or links an
      // account first, then the person goes on.
      let pending = false;
      try {
        pending = sessionStorage.getItem(GITHUB_PENDING_KEY) === '1';
        sessionStorage.removeItem(GITHUB_PENDING_KEY);
      } catch {
        /* storage blocked: nothing was pending */
      }
      const token = pending ? await api.workingGitHubToken() : null;
      if (!live) return;
      if (token) {
        setStep('start');
        return void finishGitHub(token);
      }
      const info = await api.getAccount();
      if (!live) return;
      if (info.account) {
        setEmail(info.account.email);
        return go({ account: info.account, created: false, next: '' });
      }
      setAvailable(info.available);
      setStep('start');
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (step === 'code') codeField.current?.focus();
    if (step === 'name') nameField.current?.focus();
  }, [step]);

  const github = async () => {
    setAlert(null);
    setBusy('github');
    const api = await import('../../../scripts/account-session');
    const token = await api.workingGitHubToken();
    if (token) return finishGitHub(token);
    try {
      sessionStorage.setItem(GITHUB_PENDING_KEY, '1');
    } catch {
      /* storage blocked: startSignIn says so */
    }
    try {
      const { startSignIn } = await import('../../../scripts/github-session');
      await startSignIn(location.pathname + location.search);
    } catch (err) {
      setBusy(null);
      setAlert(err instanceof Error && err.message ? err.message : W.githubOff);
    }
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = email.trim();
    if (!isEmail(value)) {
      setError(W.badEmail);
      emailField.current?.focus();
      return;
    }
    setError(null);
    setAlert(null);
    setBusy('send');
    const api = await import('../../../scripts/account-session');
    try {
      await api.sendCode(value);
      startCooldown();
      if (step === 'code') setSaid(W.resent);
      setCode('');
      setStep('code');
    } catch (err) {
      if (err instanceof api.AccountUnavailable) setAvailable(false);
      else setError(err instanceof Error ? err.message : W.failed);
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value = code) => {
    if (verifying.current) return;
    if (value.length !== CODE_LENGTH) {
      setError(W.badCode);
      codeField.current?.focus();
      return;
    }
    verifying.current = true;
    setError(null);
    setBusy('verify');
    const api = await import('../../../scripts/account-session');
    try {
      done(await api.verifyCode(email, value));
    } catch (err) {
      setError(err instanceof Error ? err.message : W.failed);
      codeField.current?.select();
    } finally {
      verifying.current = false;
      setBusy(null);
    }
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(W.nameMissing);
      nameField.current?.focus();
      return;
    }
    setError(null);
    setBusy('name');
    const api = await import('../../../scripts/account-session');
    try {
      const account = await api.renameAccount(name);
      if (after) go({ ...after, account: account ?? after.account });
    } catch (err) {
      setError(err instanceof Error ? err.message : W.failed);
      setBusy(null);
    }
  };

  /** "Not you? Use another email": the session ends, back to the email field. */
  const otherEmail = async () => {
    const api = await import('../../../scripts/account-session');
    await api.signOut().catch(() => undefined);
    setRoom(null);
    setEmail('');
    setCode('');
    setStep('start');
    requestAnimationFrame(() => emailField.current?.focus());
  };

  /** "Connect GitHub to accept": GitHub links to the account, then this screen picks the room again. */
  const connectGitHub = async () => {
    const api = await import('../../../scripts/account-session');
    try {
      if (await api.linkGitHub(location.pathname + location.search)) await enter(next ?? '/');
    } catch (err) {
      setAlert(err instanceof Error && err.message ? err.message : W.githubOff);
    }
  };

  const title = step === 'code' ? W.codeTitle : step === 'name' ? W.nameTitle : W.signInTitle;
  const lead = step === 'code' ? W.codeLead(maskEmail(email.trim())) : step === 'name' ? W.nameLead : W.signInLead;
  const header = (h: { title: string; lead: ReactNode }) => (
    <>
      <h1 id="acc-title" className="acc-title">
        {h.title}
      </h1>
      <p className="acc-lead">{h.lead}</p>
    </>
  );

  if (step === 'room' && room) {
    const rooms = { leave, onOtherEmail: () => void otherEmail(), onConnectGitHub: () => void connectGitHub() };
    return (
      <section className="zone acc acc-room" aria-labelledby="acc-title">
        <div className="acc-art" aria-hidden="true">
          <Drawing name="guide" width={96} />
        </div>
        {alert && (
          <Alert tone="danger" className="acc-alert">
            {alert}
          </Alert>
        )}
        {room.to === 'invite' && <InviteRoom {...rooms} invite={room.invite} more={room.more} email={email} header={header} />}
        {room.to === 'domain' && <DomainRoom {...rooms} domain={room.domain} teams={room.teams} header={header} />}
        {room.to === 'pick' && <PickRoom teams={room.teams} header={header} />}
      </section>
    );
  }

  return (
    <section className="zone acc" aria-labelledby="acc-title" aria-busy={step === 'loading' || step === 'leaving'}>
      <div className="acc-art" aria-hidden="true">
        <Drawing name="guide" width={96} />
      </div>
      {header({ title, lead })}
      {alert && (
        <Alert tone="danger" className="acc-alert">
          {alert}
        </Alert>
      )}

      {(step === 'start' || step === 'loading' || step === 'leaving') && (
        <div className="acc-ways">
          {available ? (
            <>
              <form className="acc-form" noValidate onSubmit={(e) => void send(e)}>
                <Input
                  ref={emailField}
                  label={W.emailLabel}
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  size="lg"
                  prefix={<Icon icon={Mail} size="sm" />}
                  placeholder={W.emailPlaceholder}
                  value={email}
                  error={error ?? undefined}
                  disabled={step !== 'start'}
                  onValueChange={(v) => {
                    setEmail(v);
                    if (error) setError(null);
                  }}
                />
                <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === 'send'} disabled={step !== 'start'}>
                  {W.sendCode}
                </Button>
              </form>
            </>
          ) : (
            // A site without accounts: GitHub is its one way in, as before.
            <>
              <Button variant="primary" size="lg" fullWidth iconStart={GitHubMark} loading={busy === 'github'} disabled={step !== 'start'} onClick={() => void github()}>
                {busy === 'github' ? W.githubBusy : W.github}
              </Button>
              {step === 'start' && <p className="acc-quiet">{W.unavailable}</p>}
            </>
          )}
        </div>
      )}

      {step === 'code' && (
        <form
          className="acc-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <Input
            ref={codeField}
            label={W.codeLabel}
            hint={W.codeHint}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            size="lg"
            className="acc-code"
            value={code}
            error={error ?? undefined}
            onValueChange={(v) => {
              const digits = codeDigits(v);
              setCode(digits);
              if (error) setError(null);
              // Pasted or typed in full: checked at once.
              if (digits.length === CODE_LENGTH && digits !== code) void verify(digits);
            }}
          />
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === 'verify'}>
            {W.verify}
          </Button>
          <div className="acc-row">
            <Button variant="link" size="sm" disabled={left > 0 || busy === 'send'} onClick={() => void send()}>
              {left > 0 ? W.resendIn(left) : W.resend}
            </Button>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setStep('start');
                setCode('');
                setError(null);
                setSaid('');
                requestAnimationFrame(() => emailField.current?.focus());
              }}
            >
              {W.otherEmail}
            </Button>
          </div>
        </form>
      )}

      {step === 'name' && (
        <form className="acc-form" noValidate onSubmit={(e) => void saveName(e)}>
          <Input
            ref={nameField}
            label={W.nameLabel}
            name="name"
            autoComplete="name"
            size="lg"
            placeholder={W.namePlaceholder}
            value={name}
            error={error ?? undefined}
            onValueChange={(v) => {
              setName(v);
              if (error) setError(null);
            }}
          />
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === 'name'}>
            {W.nameSave}
          </Button>
        </form>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      <div className="acc-foot">
        {step === 'start' && (
          <p className="acc-quiet">
            {W.demoLead} <Link href={DEMO_HOME}>{W.demo}</Link>
          </p>
        )}
        <p className="acc-quiet">
          <Link href={PRIVACY_PAGE}>{W.privacy}</Link>
        </p>
      </div>
    </section>
  );
}
