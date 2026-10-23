// Studio Home on a team shell (multi-team PR 3b): the same home as /studio/ (components/ds/studio/StudioHome.tsx, the
// GitHub rows of scripts/home-data.ts), with the repo facts the self-hosted page embeds at build time computed in the
// browser from the team's repo model instead: contrast failures, the component list of Create branch, the guidance
// drafts waiting for review. Adoption is not compared here: a team's audits are not paired before and after a move
// the way the demo's are, so its figures live on Quality only. The setup steps are not shown here (they belong to the
// onboarding of hosted teams, multi-team PR 3c).
import { createElement, Fragment } from 'react';
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
import { ENTRY_WORDS, JOINED_KEY, joinedNote } from '../lib/entry';
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
 * Approve and Decline on a join request (board E7b). After a decision the row goes at once (`onGone`) and the home
 * recounts; the toast says what happened, with Undo for a short while: the request comes back (`onBack`). An account
 * without a GitHub admin linked gets "Connect GitHub to manage requests", never the refusal.
 */
export function joinHandlers(repo: () => string, onGone: (key: string) => void, onBack: (key: string) => void = () => undefined): JoinHandlers {
  return {
    decide: async (row, approve) => {
      const id = row.request?.id;
      const name = row.request?.name ?? row.title;
      if (!id) return { ok: false, github: false, text: ENTRY_WORDS.githubToManage };
      const api = await import('./entry-session');
      try {
        if (approve) await api.approveRequest(repo(), id);
        else await api.declineRequest(repo(), id);
        onGone(row.key);
        return { ok: true, undo: true, text: approve ? ENTRY_WORDS.joined(name) : ENTRY_WORDS.declined(name) };
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
    undo: async (row) => {
      const id = row.request?.id;
      const name = row.request?.name ?? row.title;
      if (!id) return { ok: false, github: false, text: '' };
      const api = await import('./entry-session');
      try {
        await api.undoDecision(repo(), id);
        onBack(row.key);
        return { ok: true, text: ENTRY_WORDS.undone(name) };
      } catch (err) {
        return { ok: false, github: api.needsGitHubAdmin(err), text: err instanceof Error ? err.message : '' };
      }
    },
    connectGitHub: () => {
      void import('./account-session').then(({ linkGitHub }) => linkGitHub(location.pathname + location.search));
    },
  };
}

/**
 * The home's repo facts before the team's design system is read: no components, no failing pair, no guidance draft.
 * The greeting and what Bridge itself knows (join requests) paint with it at once; the rest fills in once read.
 */
export function placeholderHomeStatic(): TeamHomeStatic {
  return { contrastFail: 0, components: [], guidance: [], startHrefs: { tokens: startChangeHref('look'), component: startChangeHref('variant'), guidance: studioHref('components/') } };
}

/** The page's h1 when the failure takes the home's place: the home paints its own otherwise. */
const loadingHeading = () => createElement('h1', { className: 'sr-only' }, 'Home');

/**
 * Paints the team home into `el` (the [data-studio-home] mount), the source line into `sourceEl`, and the design
 * system read (its progress, or why it failed) into `dsEl`. Bridge's own parts (the greeting, join requests) never wait
 * for that read: GitHub can be slow, refuse, or the team be large; the home is there at once and fills in.
 */
export function initTeamHome(el: HTMLElement, sourceEl: HTMLElement | null, dsEl: HTMLElement | null = null) {
  let root: Root | null = null;
  let sourceRoot: Root | null = null;
  let dsRoot: Root | null = null;
  /** The repo facts, once the team's design system is read; null until then (placeholderHomeStatic stands in). */
  let stat: TeamHomeStatic | null = null;
  const placeholder = placeholderHomeStatic();
  const facts = () => stat ?? placeholder;
  /** Repaints the running loadHome with the facts now known (no GitHub read). */
  let repaintHome: (() => void) | null = null;
  let data: HomeData | null = null;
  let known = false;
  // Just joined from Entry: the home says so once (lib/entry.ts JOINED_KEY), then the note is gone.
  let note: string | null = null;
  try {
    const t = teamOfPage();
    note = t ? joinedNote(sessionStorage.getItem(JOINED_KEY), `${t.owner}/${t.repo}`) : null;
    if (note) sessionStorage.removeItem(JOINED_KEY);
  } catch {
    note = null;
  }
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
    (key) => {
      gone.delete(key);
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
    if (exploring()) {
      // The demo's home is all repository data: it waits for the read, as before.
      if (!stat) {
        root ??= createRoot(el);
        root.render(createElement(TeamLoadProgress, { label: "Reading this team's design system" }));
        return;
      }
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
    const f = facts();
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
        components: f.components,
        signedOut: { line: signedOutLine(signIn), button: ghButton(signIn), signIn },
        failed: d?.failed ?? null,
        startHrefs: f.startHrefs,
        // No review right: only what waits on them, and their tour (once the owner teams are read).
        contributor: Boolean(d && !d.loading && !d.reviewer),
        join,
        note,
      },
      root,
    );
  }

  function reload() {
    if (exploring()) {
      paint();
      return;
    }
    data = null;
    repaintHome = null;
    const mine = ++run;
    paint();
    void loadHome(
      facts,
      (d) => {
        if (mine !== run) return;
        data = d;
        paint();
        if (!d.loading && !d.failed && d.viewer) {
          setReviewCount(d.decisions);
          rememberMine(d.decisions);
        }
        if (!d.viewer) setReviewCount(null);
      },
      (fn) => {
        if (mine === run) repaintHome = fn;
      },
    );
  }

  /** The design system part: its progress while it is read, why it failed, or nothing once it is there. */
  function paintDs(node: Parameters<Root['render']>[0] | null) {
    if (!dsEl) return;
    dsRoot ??= createRoot(dsEl);
    dsRoot.render(node);
  }

  function start() {
    // How far the read has gone, under the home (a Refresh keeps the home and its facts on screen instead).
    if (!stat) paintDs(createElement(TeamLoadProgress, { label: "Reading this team's design system" }));
    paint();
    loadTeamData().then(
      (loaded) => {
        const first = !stat;
        stat = teamHomeStatic(loaded);
        paintDs(null);
        sourceRoot ??= sourceEl ? createRoot(sourceEl) : null;
        sourceRoot?.render(createElement(TeamSourceNote, { data: loaded, refreshing: false, onRefresh: () => (resetTeamData(), start()) }));
        // The demo waited for this read; a team's home only takes the facts in (contrast, guidance drafts).
        if (exploring()) {
          paint();
          if (known && first) reload();
        } else if (repaintHome) repaintHome();
        else paint();
      },
      (err: unknown) => {
        const team = teamOfPage();
        const failure = teamFailure(err, team ? `${team.owner}/${team.repo}` : 'this repository');
        const retry = () => (resetTeamData(), start());
        // Without a slot for it (or on the demo, all repository data), the failure takes the home's place, as before.
        if (!dsEl || exploring()) {
          root ??= createRoot(el);
          root.render(createElement(Fragment, null, loadingHeading(), createElement(TeamLoadError, { failure, onRetry: retry })));
          return;
        }
        paintDs(createElement(TeamLoadError, { failure, onRetry: retry, compact: true }));
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
