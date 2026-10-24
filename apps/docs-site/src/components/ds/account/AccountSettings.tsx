// The account, for a Bridge account (GET /api/account), in the Account dialog of the account menu (AccountMenu.tsx):
// Settings starts with the team, never the person (board D9). One row per thing, each action on the line of what it
// acts on. The name and email with Rename (inline form); GitHub linked, or Link GitHub with the one line saying
// why (only to review on GitHub or connect a repository); the person's teams, each opening its space with its role; Sign out and
// Sign out everywhere; then Delete my account, confirmed in the page (type DELETE), never window.confirm. Before the
// confirm field, Bridge asks the server whether a team would refuse it (the only admin of a team with other members):
// that team is named first, with "Make <name> admin" inline or "Hand over the team", and the field comes once it is
// clear. Nothing shows signed out or on a site without accounts.
import { useState, type FormEvent } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { Alert, Avatar, Badge, Button, Dialog, DialogContent, Divider, Icon, Input, Link } from '@bridge-ds/react';
import { GitHubMark } from '../studio/brand-icons';
import { useAccount, useFace } from './AccountMenu';
import { ACCOUNT_WORDS as W, accountName, PRIVACY_PAGE, roleWord, signedOutHref, type Account, type BlockedTeam } from '../../../lib/account';
import { teamDisplayName } from '../../../lib/demo';
import { isTeamKey, teamHref } from '../../../lib/team-path';
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
      navigate.to(signedOutHref('out'));
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

/** Where an admin hands a team over: its Members (a repository's Settings), or the home of a team made in Bridge. */
const handOverHref = (repo: string) => {
  const [o = '', r = ''] = repo.split('/');
  return isTeamKey(repo) ? teamHref(o, r, null) : `${teamHref(o, r, null)}settings/`;
};

/** People offered inline before "Hand over the team" (a team made in Bridge has no Members page: everyone). */
const OFFERED = 3;

/**
 * One team that keeps the person from deleting: it names the team, says why in one line, and offers the way out on
 * the same card: "Make <name> admin" for the people who could take over, and "Hand over the team" for the rest.
 */
function LastAdmin({ team, onMade }: { team: BlockedTeam; onMade: (name: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const all = isTeamKey(team.repo);
  const offered = all ? team.people.slice(0, 10) : team.people.slice(0, OFFERED);
  const make = async (p: { name: string; email: string }) => {
    setBusy(p.email);
    setProblem(null);
    try {
      const { setEmailMemberRole } = await import('../../../scripts/invites-api');
      await setEmailMemberRole(team.repo, p.email, { role: 'admin' });
      onMade(p.name);
    } catch (err) {
      setProblem(err instanceof Error && err.message ? err.message : W.failed);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Alert
      tone="warning"
      title={W.lastAdminOf(team.name)}
      actions={
        <>
          {offered.map((p) => (
            <Button key={p.email} variant="secondary" size="sm" loading={busy === p.email} disabled={busy !== null} onClick={() => void make(p)}>
              {W.makeAdmin(p.name)}
            </Button>
          ))}
          {(!all || !offered.length) && <Link href={handOverHref(team.repo)}>{W.handOver}</Link>}
        </>
      }
    >
      {problem ?? W.lastAdminWhy}
    </Alert>
  );
}

function DeleteRow() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [blocked, setBlocked] = useState<BlockedTeam[]>([]);
  const [said, setSaid] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const confirmed = typed.trim() === W.deleteConfirmWord;
  // Before the confirm field: a team that would refuse it is said first, with its way out.
  const check = async () => {
    setChecking(true);
    setRefusal(null);
    const api = await import('../../../scripts/account-session');
    try {
      const teams = await api.deleteCheck();
      setBlocked(teams);
      setOpen(teams.length === 0);
    } catch (err) {
      setRefusal(err instanceof Error ? err.message : W.failed);
    } finally {
      setChecking(false);
    }
  };
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setRefusal(null);
    const api = await import('../../../scripts/account-session');
    try {
      await api.deleteAccount();
      navigate.to(signedOutHref('deleted'));
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
        {!open && !blocked.length && (
          <Button variant="secondary" iconStart={Trash2} loading={checking} onClick={() => void check()}>
            {W.deleteTitle}
          </Button>
        )}
      </div>
      {blocked.map((t) => (
        <LastAdmin
          key={t.repo}
          team={t}
          onMade={(name) => {
            setSaid(W.madeAdmin(name));
            void check();
          }}
        />
      ))}
      {said && (
        <p className="acc-set-sub" role="status">
          {said}
        </p>
      )}
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
                setSaid('');
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

/** Every row of the account, for a given account. */
export function AccountRows({ account }: { account: Account }) {
  return (
    <div className="acc-set" data-account-card>
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
  );
}

/** The Account dialog of the account menu: the signed-in account's rows. */
export function AccountDialog({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={W.accountTitle} description={W.accountIntro} size="md">
        <AccountRows account={account} />
      </DialogContent>
    </Dialog>
  );
}

/** The signed-in account's rows, or nothing signed out. */
export default function AccountSettings() {
  const account = useAccount();
  return account ? <AccountRows account={account} /> : null;
}
