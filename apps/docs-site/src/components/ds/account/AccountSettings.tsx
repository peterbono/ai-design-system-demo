// Settings > Account, for a Bridge account (GET /api/account): one card, one row per thing, each action on the line of
// what it acts on. The name and email with Rename (inline form); GitHub linked, or Link GitHub with the one line saying
// why (reviewers and admins approve on GitHub); the person's teams, each opening its space with its role; Sign out and
// Sign out everywhere; then Delete my account, confirmed in the page (type DELETE), never window.confirm, with the
// server's refusal said in place (the only admin of a team with other members). Nothing shows signed out or on a site
// without accounts. AccountBand wraps it in a team Settings band and falls back to the email contributor's row.
import { useState, type FormEvent, type ReactNode } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { Alert, Avatar, Badge, Button, Card, CardBody, Divider, Icon, Input, Link } from '@bridge-ds/react';
import { GitHubMark } from '../studio/brand-icons';
import { ContributorAccountBand } from '../studio/SettingsAccount';
import { useAccount, useFace } from './AccountMenu';
import { ACCOUNT_WORDS as W, accountName, PRIVACY_PAGE, roleWord, type Account } from '../../../lib/account';
import { teamDisplayName } from '../../../lib/demo';
import { teamHref } from '../../../lib/team-path';
import '../../../styles/account.css';

/** Tests replace it. */
export const navigate = { to: (href: string) => location.assign(href) };

function NameRow({ account }: { account: Account }) {
  const face = useFace(account);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(W.nameMissing);
    setBusy(true);
    const { renameAccount } = await import('../../../scripts/account-session');
    try {
      await renameAccount(name);
      setEditing(false);
      setSaid(W.renamed);
    } catch (err) {
      setError(err instanceof Error ? err.message : W.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="acc-set-row">
      <Avatar name={accountName(account)} src={face} size="md" decorative />
      {editing ? (
        <form className="acc-set-form" noValidate onSubmit={(e) => void save(e)}>
          <Input
            label={W.nameLabel}
            name="name"
            autoComplete="name"
            value={name}
            error={error ?? undefined}
            autoFocus
            onValueChange={(v) => {
              setName(v);
              if (error) setError(null);
            }}
          />
          <div className="acc-set-actions">
            <Button type="submit" variant="primary" loading={busy}>
              {W.renameSave}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setName(account.name ?? '');
                setError(null);
              }}
            >
              {W.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="acc-set-text">
            <p className="acc-set-title">{accountName(account)}</p>
            <p className="acc-set-sub">{account.email}</p>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setSaid('');
              setName(account.name ?? '');
              setEditing(true);
            }}
          >
            {W.rename}
          </Button>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

function GitHubRow({ account }: { account: Account }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = async () => {
    setBusy(true);
    setError(null);
    const { linkGitHub } = await import('../../../scripts/account-session');
    try {
      // Linked at once when this browser is signed in to GitHub; otherwise the page leaves for GitHub.
      if (await linkGitHub(location.pathname + location.search + location.hash)) setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : W.failed);
      setBusy(false);
    }
  };
  return (
    <div className="acc-set-row">
      <Icon icon={GitHubMark} size="md" />
      <div className="acc-set-text">
        <p className="acc-set-title">{account.github ? W.githubLinked(account.github.login) : W.githubNone}</p>
        {!account.github && <p className="acc-set-sub">{W.linkGitHubWhy}</p>}
        {error && <p className="acc-set-sub" role="alert">{error}</p>}
      </div>
      {!account.github && (
        <Button variant="secondary" iconStart={GitHubMark} loading={busy} onClick={() => void link()}>
          {W.linkGitHub}
        </Button>
      )}
    </div>
  );
}

function TeamsRow({ account }: { account: Account }) {
  return (
    <div className="acc-set-text">
      <p className="acc-set-title">{W.teams}</p>
      {account.teams.length === 0 ? (
        <p className="acc-set-sub">{W.noTeams}</p>
      ) : (
        <ul className="acc-set-teams">
          {account.teams.map((t) => {
            const [o = '', r = ''] = t.repo.split('/');
            return (
              <li key={t.repo} className="acc-set-team">
                <Link href={teamHref(o, r, null)}>{t.name || teamDisplayName(t.repo)}</Link>
                <Badge size="sm" tone="neutral">
                  {roleWord(t.role)}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SessionRow() {
  const [busy, setBusy] = useState<'one' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = async (all: boolean) => {
    setBusy(all ? 'all' : 'one');
    setError(null);
    const api = await import('../../../scripts/account-session');
    try {
      await (all ? api.signOutEverywhere() : api.signOut());
      navigate.to('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : W.failed);
      setBusy(null);
    }
  };
  return (
    <div className="acc-set-row">
      <div className="acc-set-text">
        <p className="acc-set-sub">{W.signOutEverywhereHelp}</p>
        {error && <p className="acc-set-sub" role="alert">{error}</p>}
      </div>
      <div className="acc-set-actions">
        <Button variant="secondary" iconStart={LogOut} loading={busy === 'one'} onClick={() => void end(false)}>
          {W.signOut}
        </Button>
        <Button variant="ghost" loading={busy === 'all'} onClick={() => void end(true)}>
          {W.signOutEverywhere}
        </Button>
      </div>
    </div>
  );
}

function DeleteRow() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const confirmed = typed.trim() === W.deleteConfirmWord;
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setRefusal(null);
    const api = await import('../../../scripts/account-session');
    try {
      await api.deleteAccount();
      navigate.to('/');
    } catch (err) {
      setRefusal(err instanceof Error ? err.message : W.failed);
      setBusy(false);
    }
  };
  return (
    <div className="acc-set">
      <div className="acc-set-row">
        <div className="acc-set-text">
          <p className="acc-set-sub">{W.deleteHelp}</p>
        </div>
        {!open && (
          <Button variant="secondary" iconStart={Trash2} onClick={() => setOpen(true)}>
            {W.deleteTitle}
          </Button>
        )}
      </div>
      {refusal && <Alert tone="danger">{refusal}</Alert>}
      {open && (
        <form className="acc-set-form" noValidate onSubmit={(e) => void remove(e)}>
          <Input label={W.deleteConfirmLabel} name="confirm" autoComplete="off" autoFocus value={typed} onValueChange={setTyped} />
          <div className="acc-set-actions">
            <Button type="submit" variant="danger" disabled={!confirmed} loading={busy}>
              {W.deleteConfirm}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setTyped('');
                setRefusal(null);
              }}
            >
              {W.cancel}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** The account card, for a given account (tests) or the signed-in one. */
export function AccountCard({ account }: { account: Account }) {
  return (
    <Card data-account-card>
      <CardBody>
        <div className="acc-set">
          <NameRow account={account} />
          <GitHubRow account={account} />
          <TeamsRow account={account} />
          <SessionRow />
          <Divider spacing="none" />
          <DeleteRow />
          <p className="acc-set-sub">
            <Link href={PRIVACY_PAGE}>{W.privacy}</Link>
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

/** Studio Settings, Account band body: the account card above the GitHub connection, when signed in with an account. */
export default function AccountSettings({ children }: { children?: ReactNode }) {
  const account = useAccount();
  return account ? <AccountCard account={account} /> : <>{children}</>;
}

/** A team's Settings: the Account band first, for an account; else the email contributor's band, as before. */
export function AccountBand() {
  const account = useAccount();
  if (!account) return <ContributorAccountBand />;
  return (
    <section className="ts-band" id="account" aria-labelledby="ts-account">
      <h2 id="ts-account" className="ts-h">
        {W.accountTitle}
      </h2>
      <p className="ts-intro">{W.accountIntro}</p>
      <AccountCard account={account} />
    </section>
  );
}
