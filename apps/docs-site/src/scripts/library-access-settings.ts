// Settings, Library access: who reads this page's team's Library, read for the section (components/ds/studio/
// LibraryAccessSection.tsx). Three contexts, never mixed (lib/library-access accessContext):
//   sample  Acme Design: its sample choice (work emails at acme.design), no call at all; Save opens the demo dialog.
//   real    any other team, Bridge's own included: the stored choice from this site (no GitHub call), else the default
//           GitHub gives (public: anyone, private: the team). Who may change it comes from the session's access
//           (repository admin), and the server checks again on GitHub.
//   none    the browser workspace, which has no repository yet.
import { accessContext, defaultSetting, SAMPLE_SETTING, type AccessContext, type AccessSetting } from '../lib/library-access';
import { libraryHref } from '../lib/library-shells';
import { demoTeamName, isDemoRepo } from '../lib/demo';
import { currentViewer, resolveAccess } from './github-session';
import { libraryAccess } from './library-access-api';
import { repoContext } from './repo-context';

export interface AccessData {
  context: AccessContext;
  /** "owner/repo". */
  repo: string;
  /** The team as people call it. */
  team: string;
  setting: AccessSetting;
  /** The team chose it (stored); false: the default GitHub gives. */
  stored: boolean;
  /** The viewer administers the repository. */
  canManage: boolean;
  /** GitHub said the repository is private; null when it did not say. */
  isPrivate: boolean | null;
  /** This site can let readers in by email (its server answers and is set up). */
  available: boolean;
  /** The Library address to share. */
  link: string;
}

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');

export async function loadAccessSettings(): Promise<AccessData> {
  const ctx = repoContext();
  const repo = `${ctx.owner}/${ctx.repo}`;
  const context = accessContext(noRepoPage() ? null : repo, noRepoPage());
  const team = isDemoRepo(repo) ? demoTeamName(repo) : repo;
  const link = `${location.origin}${libraryHref(ctx.owner, ctx.repo)}`;
  const base: AccessData = { context, repo, team, setting: defaultSetting(false), stored: false, canManage: false, isPrivate: null, available: false, link };
  if (context === 'none') return base;
  // The visitor sits in the sample admin's seat; nothing is asked, nothing is sent.
  if (context === 'sample') return { ...base, setting: SAMPLE_SETTING, stored: true, canManage: true, available: true };
  const [answer, access] = await Promise.all([libraryAccess(repo), resolveAccess({ owner: ctx.owner, repo: ctx.repo }, { anonymous: ctx.hosted })]);
  const isPrivate = typeof access?.private === 'boolean' ? access.private : null;
  return {
    ...base,
    setting: answer.setting ?? defaultSetting(isPrivate === true),
    stored: Boolean(answer.setting),
    canManage: Boolean(currentViewer() && access?.admin),
    isPrivate,
    available: answer.available,
  };
}
