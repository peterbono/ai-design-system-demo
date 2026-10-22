// The one sign-in screen of Bridge (pages/signin.astro), for sign in and sign up alike: one Harbor zone with a Field
// Guide drawing, "Sign in to Bridge" (or "Get started with Bridge" from Get started, ?new=1), Continue with GitHub
// (the one primary action), a divider, and Continue with email: the work email, Send code, then the 6-digit code
// (numeric keyboard, one-time-code autofill, a pasted "123 456" works), with a resend link on a cooldown. A new
// account without a name is asked "Your name" once. Then the person goes to `next`: the page that sent them here
// (?next=), else the server's answer (a new account: "How do you want to start?"; a known one: their team).
// Signed in already, the screen forwards at once. A site without accounts keeps GitHub only. lib/account.ts holds the
// words and rules, scripts/account-session.ts the calls.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mail } from 'lucide-react';
import { Alert, Button, Divider, Icon, Input, Link } from '@bridge-ds/react';
import { GitHubMark } from '../studio/brand-icons';
import { Drawing } from '../studio/Drawing';
import { ACCOUNT_WORDS as W, codeDigits, GITHUB_PENDING_KEY, CODE_LENGTH, defaultNext, PRIVACY_PAGE, readSignInQuery, RESEND_COOLDOWN, type SignedIn } from '../../../lib/account';
import { isEmail } from '../../../lib/invites';
import { maskEmail } from '../../../lib/library-access';
import { loadRecentTeams } from '../../../lib/recent-teams';
import { DEMO_HOME, START_PAGE } from '../../../lib/start';
import '../../../styles/account.css';

/** Tests replace it. */
export const navigate = { to: (href: string) => location.replace(href) };

type Step = 'loading' | 'start' | 'code' | 'name' | 'leaving';

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
  const [{ fresh, next }] = useState(() => readSignInQuery(location.search));
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
  const [after, setAfter] = useState('');
  const codeField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const verifying = useRef(false);

  const leave = (href: string) => {
    setStep('leaving');
    navigate.to(href);
  };

  /**
   * Where a finished sign-in goes. A brand new account follows the server ("How do you want to start?", or the Studio
   * for a GitHub account); a known one goes back to the page that sent it here, else where the server says.
   */
  const done = (r: SignedIn) => {
    const target = r.created ? r.next || START_PAGE : (next ?? (r.next || defaultNext(r.account, loadRecentTeams())));
    if (r.created && !r.account.name) {
      setAfter(target);
      setStep('name');
      return;
    }
    leave(target);
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
      if (info.account) return leave(next ?? defaultNext(info.account, loadRecentTeams()));
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
      await api.renameAccount(name);
      leave(after);
    } catch (err) {
      setError(err instanceof Error ? err.message : W.failed);
      setBusy(null);
    }
  };

  const title = step === 'code' ? W.codeTitle : step === 'name' ? W.nameTitle : fresh ? W.signUpTitle : W.signInTitle;
  const lead = step === 'code' ? W.codeLead(maskEmail(email.trim())) : step === 'name' ? W.nameLead : fresh ? W.signUpLead : W.signInLead;

  return (
    <section className="zone acc" aria-labelledby="acc-title" aria-busy={step === 'loading' || step === 'leaving'}>
      <div className="acc-art" aria-hidden="true">
        <Drawing name="guide" width={96} />
      </div>
      <h1 id="acc-title" className="acc-title">
        {title}
      </h1>
      <p className="acc-lead">{lead}</p>
      {alert && (
        <Alert tone="danger" className="acc-alert">
          {alert}
        </Alert>
      )}

      {(step === 'start' || step === 'loading' || step === 'leaving') && (
        <div className="acc-ways">
          <Button variant="primary" size="lg" fullWidth iconStart={GitHubMark} loading={busy === 'github'} disabled={step !== 'start'} onClick={() => void github()}>
            {busy === 'github' ? W.githubBusy : W.github}
          </Button>
          {available ? (
            <>
              <Divider label={W.or} spacing="sm" />
              <form className="acc-form" noValidate onSubmit={(e) => void send(e)}>
                <Input
                  ref={emailField}
                  label={W.email}
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
                <Button type="submit" variant="secondary" size="lg" fullWidth loading={busy === 'send'} disabled={step !== 'start'}>
                  {W.sendCode}
                </Button>
              </form>
            </>
          ) : (
            step === 'start' && <p className="acc-quiet">{W.unavailable}</p>
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
        {fresh && step === 'start' && (
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
