// The one sign-in screen of Bridge (pages/signin.astro), for sign in and sign up alike (boards E1 and E2): one Harbor
// zone with a Field Guide drawing, "Welcome to Bridge", the work email and Send code (the one primary action), then
// the 6-digit code (numeric keyboard, one-time-code autofill, a pasted "123 456" works), with a resend link on a
// cooldown. Email only: GitHub comes back where a repository is linked, and in Settings > Account. An account whose
// name is still a stand-in (nameSet false) is asked "One last thing: your name" once. Then the person goes to `next`
// (the page that sent them here, ?next=), else Bridge picks the room (lib/entry.ts, GET /api/entry): their team, an
// invite (E3), a team found by work domain (E4, E4b), a team picker (E5), or "Create your team" (E6). Those rooms live
// in EntryRooms.tsx, in this same zone. Signed in already, the screen forwards at once. Back from GitHub (Link GitHub,
// Connect GitHub to accept), the GitHub sign-in links to the account first. A site without accounts keeps Continue
// with GitHub, its only way in.
//
// The invite link (pages/studio/invite.astro, `invite`): one identity, the Bridge account of the invited email. The
// token (#t=, then kept in this tab only) says which invite (POST /api/entry invite-link). Signed out, the screen
// sends the code to the invited address, shown masked, and after the code (and the name) opens E3 for that invite.
// Signed in as the invited email: E3 at once. Signed in as someone else: "This invite was sent to m•••@acme.com" with
// "Sign in as that email". A member: "You're already in <team>". A spent link: whom to ask for a new one.
// lib/account.ts holds the words and rules, scripts/account-session.ts the calls.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { Alert, Button, Icon, Input, Link } from '@bridge-ds/react';
import { GitHubMark } from '../studio/brand-icons';
import { Drawing } from '../studio/Drawing';
import { ACCOUNT_WORDS as W, codeDigits, GITHUB_PENDING_KEY, CODE_LENGTH, defaultNext, PRIVACY_PAGE, readSignInQuery, RESEND_COOLDOWN, SIGNED_OUT_PARAM, signedOutNote, type Account, type SignedIn } from '../../../lib/account';
import { ENTRY_WORDS as EW, INVITE_TOKEN_KEY, JOINED_KEY, inviteTokenFromHash, routeEntry, type Entry, type EntryRoute, type InviteLink } from '../../../lib/entry';
import { DomainRoom, InviteLinkRoom, InviteRoom, PickRoom } from './EntryRooms';
import { isEmail } from '../../../lib/invites';
import { maskEmail } from '../../../lib/library-access';
import { loadRecentTeams } from '../../../lib/recent-teams';
import { DEMO_HOME, START_PAGE } from '../../../lib/start';
import '../../../styles/account.css';

/** Tests replace it. */
export const navigate = { to: (href: string) => location.replace(href) };

type Step = 'loading' | 'start' | 'code' | 'name' | 'room' | 'leaving';

/** The invite link's token: read from #t= (then out of the address bar at once), else the one kept in this tab. */
export function readInviteToken(): string | null {
  const fromHash = inviteTokenFromHash(location.hash);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  try {
    if (fromHash) sessionStorage.setItem(INVITE_TOKEN_KEY, fromHash);
    return fromHash ?? sessionStorage.getItem(INVITE_TOKEN_KEY);
  } catch {
    return fromHash;
  }
}

/** The invite is used, spent or not this account's to take: this tab forgets its token. */
export function forgetInviteToken() {
  try {
    sessionStorage.removeItem(INVITE_TOKEN_KEY);
  } catch {
    /* storage blocked: nothing kept */
  }
}

/** The rooms shown on this screen; the others are pages of their own. An invite link has its own states. */
type Room = Exclude<EntryRoute, { to: 'go' } | { to: 'create' }> | { to: 'link'; link: InviteLink };

function useCooldown(): [number, () => void, () => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, () => setLeft(RESEND_COOLDOWN), () => setLeft(0)];
}

export default function SignIn({ invite = false }: { invite?: boolean }) {
  const [{ next }] = useState(() => readSignInQuery(location.search));
  // Just signed out, or the account was just deleted: said once, above the email field.
  const [bye, setBye] = useState(() => signedOutNote(location.search));
  const [step, setStep] = useState<Step>('loading');
  const [available, setAvailable] = useState(true);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState<'github' | 'send' | 'verify' | 'name' | null>(null);
  const [said, setSaid] = useState('');
  const [left, startCooldown, endCooldown] = useCooldown();
  const [after, setAfter] = useState<SignedIn | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [me, setMe] = useState<Account | null>(null);
  /** The daily code limit answered: "I have a code" opens the code field. */
  const [limited, setLimited] = useState(false);
  /** The invite link this screen opened from (invite mode), and what the server said it is. */
  const [link, setLink] = useState<InviteLink | null>(null);
  const token = useRef<string | null>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const verifying = useRef(false);
  /** The code was accepted: no second check (it works once), the page is on its way. */
  const verified = useRef(false);
  const signedInAs = useRef<SignedIn['account'] | null>(null);

  /** Signed out on an invite link that waits: the code goes to the invited address, never typed or shown in full. */
  const viaInvite = Boolean(token.current && link?.state === 'live' && !link.signedIn);

  const leave = (href: string) => {
    forgetInviteToken();
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
      const entry = await api.getEntry();
      await seedEntry(entry);
      const r = routeEntry(entry, loadRecentTeams());
      if (r.to === 'go' || r.to === 'create') return leave(r.href);
      setRoom(r);
      setStep('room');
    } catch {
      leave(fallback);
    }
  };

  /** Every team /api/entry names as an email membership knows its member at once (scripts/contribute-session.ts). */
  const seedEntry = async (entry: Entry) => {
    const who = signedInAs.current;
    if (entry.kind !== 'teams' || !who) return;
    const { seedContributors } = await import('../../../scripts/contribute-session');
    seedContributors(who, entry.teams);
  };

  /** Just joined a team with the email account: the team's pages open signed in, not as a guest. */
  const onJoined = async (repo: string, role: string, team?: string) => {
    try {
      sessionStorage.setItem(JOINED_KEY, JSON.stringify({ repo, team: team ?? '' }));
    } catch {
      /* storage blocked: the team opens without the note */
    }
    const who = signedInAs.current ?? me;
    if (!who) return;
    const { seedContributors } = await import('../../../scripts/contribute-session');
    seedContributors(who, [{ repo, role, via: 'email' }]);
  };

  /** Invite mode: what the link is, then its room, or the code for the invited address (signed out). */
  const openLink = async (t: string) => {
    const api = await import('../../../scripts/entry-session');
    let l: InviteLink;
    try {
      l = await api.openInviteLink(t);
    } catch (err) {
      // No answer: the usual sign-in, with what went wrong.
      token.current = null;
      setAlert(err instanceof Error && err.message ? err.message : W.failed);
      setStep('start');
      return;
    }
    setLink(l);
    if (l.state === 'live' && l.invite) {
      setRoom({ to: 'invite', invite: l.invite, more: 0 });
      setStep('room');
      return;
    }
    if (l.state === 'live' && !l.signedIn) return setStep('start');
    if (l.state !== 'live') forgetInviteToken();
    setRoom({ to: 'link', link: l });
    setStep('room');
  };

  /** Where a signed-in person goes: the invite they opened, the page that sent them here, else the room Bridge picks. */
  const go = (r: SignedIn) => {
    setMe(r.account);
    // The account's email teams know their member already (scripts/account-session.ts seeds them on sign-in).
    signedInAs.current = r.account;
    if (token.current) return void openLink(token.current);
    if (next) return leave(next);
    void enter(r.created ? r.next || START_PAGE : r.next || defaultNext(r.account, loadRecentTeams()));
  };

  /** A finished sign-in: an account without a name of its own says it once, then goes on. */
  const done = (r: SignedIn) => {
    setEmail((e) => e || r.account.email);
    setMe(r.account);
    if (r.account.nameSet === false) {
      setAfter(r);
      setStep('name');
      return;
    }
    go(r);
  };

  const finishGitHub = async (gh: string) => {
    setBusy('github');
    const api = await import('../../../scripts/account-session');
    try {
      done(await api.signInWithGitHub(gh));
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
      if (invite) token.current = readInviteToken();
      const gh = pending ? await api.workingGitHubToken() : null;
      if (!live) return;
      if (gh) {
        setStep('start');
        return void finishGitHub(gh);
      }
      const info = await api.getAccount();
      if (!live) return;
      setAvailable(info.available);
      if (info.account) setMe(info.account);
      if (invite) {
        if (info.account) setEmail(info.account.email);
        if (!token.current) {
          setRoom({ to: 'link', link: { state: 'unknown', signedIn: Boolean(info.account) } });
          return setStep('room');
        }
        return void openLink(token.current);
      }
      if (info.account) {
        setEmail(info.account.email);
        return go({ account: info.account, created: false, next: '' });
      }
      setStep('start');
    })();
    return () => {
      live = false;
    };
  }, []);

  // The note is said once: a reload or a shared address does not repeat it.
  useEffect(() => {
    const url = new URL(location.href);
    if (!url.searchParams.has(SIGNED_OUT_PARAM)) return;
    url.searchParams.delete(SIGNED_OUT_PARAM);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }, []);

  // Focus follows the step: the field to fill, else the new heading, so a screen reader hears where it is.
  useEffect(() => {
    if (step === 'start') (emailField.current ?? document.getElementById('acc-title'))?.focus();
    if (step === 'code') codeField.current?.focus();
    if (step === 'name') nameField.current?.focus();
    if (step === 'room') document.getElementById('acc-title')?.focus();
  }, [step, room]);

  const github = async () => {
    setAlert(null);
    setBusy('github');
    const api = await import('../../../scripts/account-session');
    const gh = await api.workingGitHubToken();
    if (gh) return finishGitHub(gh);
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

  /** Who the code is for: the invited address (by the link's token), else the email typed. */
  const codeFor = () => (viaInvite && token.current ? { invite: token.current } : email.trim());

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = email.trim();
    if (!viaInvite && !isEmail(value)) {
      setError(W.badEmail);
      emailField.current?.focus();
      return;
    }
    setError(null);
    setAlert(null);
    setBusy('send');
    setBye(null);
    verified.current = false;
    const api = await import('../../../scripts/account-session');
    try {
      await api.sendCode(codeFor());
      startCooldown();
      setLimited(false);
      if (step === 'code') setSaid(W.resent);
      setCode('');
      setStep('code');
    } catch (err) {
      if (err instanceof api.AccountUnavailable) setAvailable(false);
      else {
        // The daily limit: the latest code still works, so the code field stays one click away.
        if (err instanceof api.AccountError && err.status === 429) setLimited(true);
        setError(err instanceof Error ? err.message : W.failed);
      }
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value = code) => {
    // In flight or already accepted: the 6th digit checks it at once, so an Enter right after must not send it again.
    if (verifying.current || verified.current) return;
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
      const r = await api.verifyCode(codeFor(), value);
      verified.current = true;
      done(r);
    } catch (err) {
      const tries = err instanceof api.AccountError ? err.details.triesLeft : undefined;
      const text = err instanceof Error ? err.message : W.failed;
      setError(typeof tries === 'number' && tries > 0 ? `${text} ${W.triesLeft(tries)}` : text);
      // Expired, or burned by wrong tries: only a new code helps, so "Send a new code" works at once.
      if (err instanceof api.AccountError && err.status === 410) {
        endCooldown();
        setCode('');
      }
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
      setBusy(null);
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
    token.current = null;
    forgetInviteToken();
    setLink(null);
    setMe(null);
    setRoom(null);
    setEmail('');
    setCode('');
    setStep('start');
  };

  /** "Sign in as that email" (an invite sent to another address): sign out, then the code to the invited address. */
  const signInAsInvited = async () => {
    const api = await import('../../../scripts/account-session');
    await api.signOut().catch(() => undefined);
    setMe(null);
    setEmail('');
    setCode('');
    setRoom(null);
    setLink((l) => (l ? { ...l, signedIn: false } : l));
    setStep('start');
  };

  /** "Continue as ...": the invite is not for this account, Bridge picks the room as after any sign-in. */
  const continueAsMe = () => {
    token.current = null;
    forgetInviteToken();
    setRoom(null);
    setStep('loading');
    void enter('/');
  };

  /** "Connect GitHub to accept": GitHub links to the account, then this screen picks the room again. */
  const connectGitHub = async () => {
    const api = await import('../../../scripts/account-session');
    try {
      if (await api.linkGitHub(location.pathname + location.search)) {
        setMe((await api.getAccount()).account);
        if (token.current) await openLink(token.current);
        else await enter(next ?? '/');
      }
    } catch (err) {
      setAlert(err instanceof Error && err.message ? err.message : W.githubOff);
    }
  };

  const sentTo = link?.state === 'live' ? link.sentTo : '';
  const header = (h: { title: string; lead: ReactNode }) => (
    <>
      <h1 id="acc-title" className="acc-title" tabIndex={-1}>
        {h.title}
      </h1>
      <p className="acc-lead">{h.lead}</p>
    </>
  );
  const startHeader =
    viaInvite && link?.state === 'live'
      ? {
          title: EW.linkTitle(link.team),
          lead: (
            <>
              {EW.linkLead(link.invitedBy)} <strong className="ent-strong">{link.sentTo}</strong>
              {EW.linkLeadEnd}
            </>
          ),
        }
      : { title: W.signInTitle, lead: W.signInLead };
  const top =
    step === 'code'
      ? { title: W.codeTitle, lead: W.codeLead(viaInvite ? sentTo : maskEmail(email.trim())) }
      : step === 'name'
        ? { title: W.nameTitle, lead: W.nameLead }
        : invite && step === 'loading'
          ? { title: EW.opening, lead: '' }
          : startHeader;

  if (step === 'room' && room) {
    const rooms = { leave, onJoined, onOtherEmail: () => void otherEmail(), onConnectGitHub: () => void connectGitHub() };
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
        {room.to === 'invite' && <InviteRoom {...rooms} invite={room.invite} more={room.more} email={email} github={Boolean(me?.github)} header={header} />}
        {room.to === 'domain' && <DomainRoom {...rooms} domain={room.domain} teams={room.teams} header={header} />}
        {room.to === 'pick' && <PickRoom teams={room.teams} header={header} />}
        {room.to === 'link' && (
          <InviteLinkRoom link={room.link} email={email} header={header} onSignInAs={() => void signInAsInvited()} onContinue={continueAsMe} />
        )}
      </section>
    );
  }

  return (
    <section className="zone acc" aria-labelledby="acc-title" aria-busy={step === 'loading' || step === 'leaving'}>
      <div className="acc-art" aria-hidden="true">
        <Drawing name="guide" width={96} />
      </div>
      {header(top)}
      {bye && step !== 'code' && step !== 'name' && (
        <Alert tone="success" className="acc-alert" onDismiss={() => setBye(null)}>
          {bye}
        </Alert>
      )}
      {alert && (
        <Alert tone="danger" className="acc-alert">
          {alert}
        </Alert>
      )}

      {(step === 'start' || step === 'leaving' || (step === 'loading' && !invite)) && (
        <div className="acc-ways">
          {available ? (
            <form className="acc-form" noValidate onSubmit={(e) => void send(e)}>
              {viaInvite ? (
                error && (
                  <Alert tone="warning" className="acc-alert">
                    {error}
                  </Alert>
                )
              ) : (
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
                    if (limited) setLimited(false);
                  }}
                />
              )}
              <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === 'send'} disabled={step !== 'start'}>
                {W.sendCode}
              </Button>
              {limited && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setLimited(false);
                    setCode('');
                    setStep('code');
                  }}
                >
                  {W.haveCode}
                </Button>
              )}
            </form>
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
            {!viaInvite && (
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setStep('start');
                  setCode('');
                  setError(null);
                  setSaid('');
                }}
              >
                {W.otherEmail}
              </Button>
            )}
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
        {step === 'start' && viaInvite && link?.state === 'live' && <p className="acc-quiet">{EW.linkNotYours(link.invitedBy)}</p>}
        {step === 'start' && !viaInvite && (
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
