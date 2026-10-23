// Studio Home on a team shell (multi-team PR 3b): the same home as /studio/ (components/ds/studio/StudioHome.tsx, the
// GitHub rows of scripts/home-data.ts), with the repo facts the self-hosted page embeds at build time computed in the
// browser from the team's repo model instead: contrast failures, the component list of Create branch, the guidance
// drafts waiting for review. Adoption is not compared here: a team's audits are not paired before and after a move
// the way the demo's are, so its figures live on Quality only. The setup steps are not shown here (they belong to the
// onboarding of hosted teams, multi-team PR 3c).
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { currentAccess, currentContributor, currentViewer, getToken, initGitHubConnect, onAccess, prefersSignIn } from './github-session';
import { setReviewCount } from './shell';
import { rememberMine } from './needs-you';
import { loadHome, type HomeData, type HomeStatic } from './home-data';
import { loadTeamData, resetTeamData, teamOfPage, type TeamData } from './team-data';
import { loadDemoHome, type DemoHomeData } from './demo-home';
import { paintDemoHome } from '../components/ds/studio/DemoHome';
import { exploresDemo } from '../lib/demo';
import { paintStudioHome, type HealthLine, type HomeComponent, type JoinHandlers, type StudioHomeProps } from '../components/ds/studio/StudioHome';
import { ENTRY_WORDS } from '../lib/entry';
import { TeamLoadError, TeamLoadProgress, TeamSourceNote } from '../components/ds/studio/TeamState';
import { greeting, homeState } from '../lib/home-model';
import { startChangeHref } from '../lib/overview-board';
import { signedOutLine } from '../lib/overview-todo';
import { ghButton } from '../lib/gh-wording';
import { studioHref } from '../lib/team-path';
import { fileUrl, teamFailure } from '../lib/team-load';
import { contrastFailures, teamGuidance } from '../lib/team-facts';

export interface TeamHomeStatic extends HomeStatic {
  components: HomeComponent[];
  startHrefs: StudioHomeProps['startHrefs'];
}

// The contrast count lives in lib/team-facts.ts (shared with team Review); re-exported for existing callers.
export { contrastFailures };

/** The repo facts of Studio Home for a team (what /studio/ embeds as #home-static), from its repo model. Pure. */
export function teamHomeStatic(data: Pick<TeamData, 'owner' | 'repo' | 'sha' | 'model'>): TeamHomeStatic {
  const comps = data.model.components?.list ?? [];
  const missing = comps.find((c) => !c.docs);
  return {
    contrastFail: contrastFailures(data.model),
    components: comps.map((c) => ({ name: c.name, slug: c.slug, family: c.category })).sort((a, b) => a.name.localeCompare(b.name)),
    // Drafted guidance waits for review: the row opens the draft on GitHub (the docs editor is the demo Library's).
    guidance: teamGuidance(data),
    startHrefs: {
      tokens: startChangeHref('look'),
      component: startChangeHref('variant'),
      guidance: missing ? fileUrl(data.owner, data.repo, data.sha, missing.dir) : studioHref('components/'),
    },
  };
}

/**
 * Approve and Decline on a join request (board E7b). After a decision the row says what happened, then `onGone` takes
 * it away. An account without a GitHub admin linked gets "Connect GitHub to manage requests", never the refusal.
 */
export function joinHandlers(repo: () => string, onGone: (key: string) => void, wait = 4000): JoinHandlers {
  return {
    decide: async (row, approve) => {
      const id = row.request?.id;
      const name = row.request?.name ?? row.title;
      if (!id) return { ok: false, github: false, text: ENTRY_WORDS.githubToManage };
      const api = await import('./entry-session');
      try {
        if (approve) await api.approveRequest(repo(), id);
        else await api.declineRequest(repo(), id);
        setTimeout(() => onGone(row.key), wait);
        return { ok: true, text: approve ? ENTRY_WORDS.joined(name) : ENTRY_WORDS.declined(name) };
      } catch (err) {
        if (api.needsGitHubAdmin(err)) return { ok: false, github: true, text: ENTRY_WORDS.githubToManage };
        // Already answered or expired: the row goes, like after a decision.
        if (err instanceof api.EntryError && err.status === 404) {
          onGone(row.key);
          return { ok: true, text: err.message };
        }
        return { ok: false, github: false, text: err instanceof Error ? err.message : '' };
      }
    },
    connectGitHub: () => {
      void import('./account-session').then(({ linkGitHub }) => linkGitHub(location.pathname + location.search));
    },
  };
}

/** Paints the team home into `el` (the [data-studio-home] mount), and the source line into `sourceEl`. */
export function initTeamHome(el: HTMLElement, sourceEl: HTMLElement | null) {
  let root: Root | null = null;
  let sourceRoot: Root | null = null;
  let stat: TeamHomeStatic | null = null;
  let data: HomeData | null = null;
  let known = false;
  let run = 0;
  // Join requests decided on this page: gone from the list until the next read.
  const gone = new Set<string>();
  const join = joinHandlers(
    () => {
      const t = teamOfPage();
      return t ? `${t.owner}/${t.repo}` : '';
    },
    (key) => {
      gone.add(key);
      paint();
    },
  );
  const signIn = prefersSignIn();
  // The demo team, for a visitor who cannot change it (lib/demo.ts): its own home, read-only.
  let demoData: DemoHomeData | null = null;
  let demoRead = false;
  const exploring = () => {
    const t = teamOfPage();
    if (!t || (!known && getToken())) return false;
    const v = currentViewer();
    // An email contributor is a member of the team: never a demo visitor.
    if (!v && currentContributor()) return false;
    return exploresDemo({ repo: `${t.owner}/${t.repo}`, signedIn: Boolean(v), write: v ? (currentAccess()?.write ?? null) : false });
  };
  const readDemo = () => {
    if (demoRead || !stat) return;
    demoRead = true;
    const t = teamOfPage();
    void loadDemoHome(stat, (d) => {
      demoData = d;
      paint();
    });
  };

  function health(): HealthLine | null {
    if (!stat) return null;
    return stat.contrastFail ? null : { text: 'Library healthy.', tone: 'ok', href: studioHref('quality/'), link: 'Open Quality' };
  }

  function paint() {
    if (!stat) return;
    if (exploring()) {
      readDemo();
      root = paintDemoHome(
        el,
        {
          loading: !demoData || demoData.loading,
          needs: demoData?.needs ?? [],
          branches: demoData?.branches ?? [],
          health: health(),
          failed: demoData?.failed ?? null,
            lead: demoData?.lead ?? null,
            role: demoData?.role ?? null,
          now: Date.now(),
          components: stat.components,
          startHrefs: stat.startHrefs,
        },
        root,
      );
      return;
    }
    const now = Date.now();
    const v = currentViewer();
    const signedIn = Boolean(v) || (!known && Boolean(getToken()));
    const d = data && gone.size ? { ...data, needs: data.needs.filter((r) => !gone.has(r.key)) } : data;
    const state = homeState({ signedIn, loading: !d || d.loading, needs: d?.needs.length ?? 0, branches: d?.branches.length ?? 0 });
    root = paintStudioHome(
      el,
      {
        state,
        greeting: greeting(new Date(now).getHours(), v?.name ?? null),
        needs: d?.needs ?? [],
        branches: d?.branches ?? [],
        health: health(),
        now,
        components: stat.components,
        signedOut: { line: signedOutLine(signIn), button: ghButton(signIn), signIn },
        failed: d?.failed ?? null,
        startHrefs: stat.startHrefs,
        // No review right: only what waits on them, and their tour (once the owner teams are read).
        contributor: Boolean(d && !d.loading && !d.reviewer),
        join,
      },
      root,
    );
  }

  function reload() {
    if (!stat) return;
    if (exploring()) {
      paint();
      return;
    }
    data = null;
    const mine = ++run;
    paint();
    void loadHome(stat, (d) => {
      if (mine !== run) return;
      data = d;
      paint();
      if (!d.loading && !d.failed && d.viewer) {
        setReviewCount(d.decisions);
        rememberMine(d.decisions);
      }
      if (!d.viewer) setReviewCount(null);
    });
  }

  function start() {
    // How far the read has gone, until the home can paint (a Refresh keeps the home on screen instead).
    if (!stat) {
      root ??= createRoot(el);
      root.render(createElement(TeamLoadProgress, { label: "Reading this team's design system" }));
    }
    loadTeamData().then(
      (loaded) => {
        stat = teamHomeStatic(loaded);
        sourceRoot ??= sourceEl ? createRoot(sourceEl) : null;
        sourceRoot?.render(createElement(TeamSourceNote, { data: loaded, refreshing: false, onRefresh: () => (resetTeamData(), start()) }));
        paint();
        if (known) reload();
      },
      (err: unknown) => {
        const team = teamOfPage();
        root ??= createRoot(el);
        root.render(createElement(TeamLoadError, { failure: teamFailure(err, team ? `${team.owner}/${team.repo}` : 'this repository'), onRetry: () => (resetTeamData(), start()) }));
      },
    );
  }

  start();
  onAccess(() => paint());
  initGitHubConnect(() => {
    known = true;
    reload();
  });
}
