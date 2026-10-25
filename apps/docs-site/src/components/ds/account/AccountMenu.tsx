// Who is signed in, with a Bridge account (GET /api/account), on every Studio page: the account row at the foot of
// the side nav (the GitHub-only block steps aside, styles/account.css) and the avatar of the top bar on screens
// without a nav (the sign-in, start and invite screens). One DS Menu: the name and email, GitHub linked or Link GitHub,
// Account settings (the Account dialog: name, email, teams, sign out everywhere, delete; Settings itself starts with
// the team, board D9), Sign out. An old link to #account opens the dialog. The face is the GitHub photo once linked, else the DS drawn face (never initials). The
// row's second line is the person's role on this team, else their email. Nothing shows signed out or on a site
// without accounts: the GitHub block keeps working as before.
import { useEffect, useState } from 'react';
import { Compass, LogOut, Settings } from 'lucide-react';
import { Avatar, Button, Icon, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, VisuallyHidden } from '@bridge-ds/react';
import { ChevronsUpDown } from 'lucide-react';
import { GitHubMark } from '../studio/brand-icons';
import { ACCOUNT_WORDS as W, accountName, roleWord, signedOutHref, type Account } from '../../../lib/account';
import { ownerAvatarUrl } from '../../../lib/access-view';
import { AccountDialog } from './AccountSettings';
import { DEMO_HOME } from '../../../lib/start';
import { DEMO_WORDS } from '../../../lib/demo';
import '../../../styles/account.css';

/** The drawn face of an email (lazy: the drawings are a separate chunk), or the GitHub photo once linked. */
export function useFace(account: Account | null): string | undefined {
  const [face, setFace] = useState<string | undefined>(undefined);
  const login = account?.github?.login;
  const email = account?.email;
  useEffect(() => {
    let live = true;
    if (login) setFace(ownerAvatarUrl(login, 64));
    else if (email) void import('@bridge-ds/react/avatar-illustrated').then(({ illustratedAvatarUri }) => live && setFace(illustratedAvatarUri(email)));
    else setFace(undefined);
    return () => {
      live = false;
    };
  }, [login, email]);
  return face;
}

/** The signed-in account, read once per page and kept in step (scripts/account-session.ts). */
export function useAccount(): Account | null {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;
    void import('../../../scripts/account-session').then(({ getAccount, onAccountChange }) => {
      if (!live) return;
      stop = onAccountChange((a) => live && setAccount(a));
      void getAccount().then((i) => live && setAccount(i.account));
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return account;
}

/** "owner/repo" of this team page, or null on a page that reads no repository. */
function pageTeam(): string | null {
  const root = document.documentElement;
  if (root.hasAttribute('data-no-repo') || !root.hasAttribute('data-hosted')) return null;
  const m = /^\/studio\/(?:~\/)?([^/]+)\/([^/]+)\//.exec(location.pathname);
  return m ? `${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}` : null;
}

export interface AccountMenuProps {
  /** The top bar: the face alone. Otherwise the side nav's full-width row. */
  compact?: boolean;
}

export default function AccountMenu({ compact = false }: AccountMenuProps) {
  const account = useAccount();
  const face = useFace(account);
  const [team, setTeam] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setTeam(pageTeam()), []);
  // Settings' old #account anchor (and the former Account settings links) opens the dialog.
  useEffect(() => {
    if (account && location.hash === '#account') setOpen(true);
  }, [account]);
  if (!account) return null;

  const name = accountName(account);
  const here = team ? account.teams.find((t) => t.repo.toLowerCase() === team.toLowerCase()) : undefined;
  const line = here ? roleWord(here.role) : account.email;
  const signOut = async () => {
    setBusy(true);
    const { signOut: end } = await import('../../../scripts/account-session');
    try {
      await end();
      // The sign-in screen says "You're signed out", and brings them back here once signed in again.
      location.assign(signedOutHref('out', location.pathname + location.search));
    } catch {
      location.reload();
    }
  };
  const link = async () => {
    const { linkGitHub } = await import('../../../scripts/account-session');
    await linkGitHub(location.pathname + location.search + location.hash);
  };

  // Named by what it shows (WCAG 2.5.3: voice control finds it by its visible text): the person's name and their role or
  // email, then a hidden "account menu". The face is decorative; the top bar's face alone says who is signed in.
  return (
    <>
    <Menu>
      {compact ? (
        <MenuTrigger render={<Button variant="ghost" size="sm" className="acc-menu-trigger" />}>
          <Avatar name={name} src={face} size="sm" decorative />
          <VisuallyHidden>{W.signedInAs(name)}, account menu</VisuallyHidden>
        </MenuTrigger>
      ) : (
        <MenuTrigger render={<Button variant="ghost" fullWidth className="acc-menu-trigger" />}>
          <Avatar name={name} src={face} size="md" decorative />
          <span className="acc-menu-text">
            <span className="acc-menu-name">{name}</span>
            <VisuallyHidden>,</VisuallyHidden>{' '}
            <span className="acc-menu-line">{line}</span>
            <VisuallyHidden>, account menu</VisuallyHidden>
          </span>
          <Icon icon={ChevronsUpDown} size="sm" />
        </MenuTrigger>
      )}
      <MenuContent align={compact ? 'end' : 'start'} side={compact ? 'bottom' : 'top'}>
        <div className="acc-menu-head">
          <span className="acc-menu-name">{name}</span>
          <span className="acc-menu-line">{account.email}</span>
          <span className="acc-menu-line">{account.github ? W.githubLinked(account.github.login) : W.githubNone}</span>
        </div>
        <MenuSeparator />
        {!account.github && (
          <MenuItem icon={GitHubMark} onClick={() => void link()}>
            {W.linkGitHub}
          </MenuItem>
        )}
        <MenuItem icon={Settings} onClick={() => setOpen(true)}>
          {W.settings}
        </MenuItem>
        {/* The sample team, apart from the member's real teams (the team menu lists only those). */}
        <MenuItem icon={Compass} onClick={() => location.assign(DEMO_HOME)}>
          {DEMO_WORDS.tryIt}
        </MenuItem>
        <MenuItem icon={LogOut} disabled={busy} onClick={() => void signOut()}>
          {W.signOut}
        </MenuItem>
      </MenuContent>
    </Menu>
    <AccountDialog account={account} open={open} onOpenChange={setOpen} />
    </>
  );
}
