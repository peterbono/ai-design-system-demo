// On the demo (lib/demo.ts DEMO_REPOS), a visitor who cannot write to it explores freely (boards D1 and D2):
//   - the "Demo workspace" banner over every Studio page (components/ds/studio/DemoBanner.tsx), with "Use your own
//     repo", which opens "Create a new team" (NewTeamDialog.tsx);
//   - every action that would change the demo opens "Sign in with GitHub to do this for real."
//     (components/ds/studio/MakeItYours.tsx) instead of failing or asking for a GitHub sign-in out of context.
// Someone who can write to the demo (its owner) keeps the normal Studio.
//
// Which actions: any element marked [data-demo-write="<what it does>"] ("create branches", "approve changes"), and
// the actions the session gates while signed out ([data-gh-gate="<verb phrase>"]). One capture listener on the
// document, wired once by the shared GitHub session (scripts/github-session.ts initGitHubConnect), so it runs before
// the page's own handlers and before the session opens its sign-in dialog. The React parts load on first use.
import { exploresDemo } from '../lib/demo';

export interface DemoGateDeps {
  /** "owner/repo" of the page. */
  repo: () => string;
  /** The GitHub login when signed in. */
  login: () => string | null;
  /** Write access on the page's repository: null while GitHub has not said. */
  write: () => boolean | null;
  /** The site signs in with GitHub. */
  signIn: () => boolean;
  /** False while a saved sign-in is still being checked: the Studio acts as usual until then. */
  known: () => boolean;
  /** Calls `fn` whenever who is visiting, or what they can do, changes. */
  subscribe: (fn: () => void) => void;
}

let deps: DemoGateDeps | null = null;

/** True when this visitor explores the demo: write actions open the demo dialog. */
export function exploringDemo(): boolean {
  if (!deps || !deps.known()) return false;
  const login = deps.login();
  return exploresDemo({ repo: deps.repo(), signedIn: Boolean(login), write: login ? deps.write() : false });
}

type Layer = { dialog: boolean; team: boolean };
let paintLayer: ((next: Partial<Layer>) => void) | null = null;
let loading: Promise<void> | null = null;

/** The dialogs of the demo, mounted once in their own root at the end of the body. */
function layer(): Promise<void> {
  loading ??= (async () => {
    const [{ createElement, Fragment }, { createRoot }, { MakeItYours }, { default: NewTeamDialog }, { teamAccessCheck }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../components/ds/studio/MakeItYours'),
      import('../components/ds/studio/NewTeamDialog'),
      import('./team-check'),
    ]);
    const el = document.createElement('div');
    el.dataset.demoLayer = '';
    document.body.append(el);
    const root = createRoot(el);
    let state: Layer = { dialog: false, team: false };
    paintLayer = (next) => {
      state = { ...state, ...next };
      root.render(
        createElement(
          Fragment,
          null,
          createElement(MakeItYours, { open: state.dialog, onOpenChange: (o: boolean) => paintLayer!({ dialog: o }), signIn: deps?.signIn() ?? true }),
          createElement(NewTeamDialog, { open: state.team, onOpenChange: (o: boolean) => paintLayer!({ team: o }), signedIn: Boolean(deps?.login()), check: teamAccessCheck }),
        ),
      );
    };
  })();
  return loading;
}

/** Opens "Sign in with GitHub to do this for real." (board D2). */
export async function openMakeItYours(): Promise<void> {
  await layer();
  paintLayer!({ dialog: true, team: false });
}

/** Opens "Create a new team": the visitor's own design system. */
export async function openUseOwnRepo(): Promise<void> {
  await layer();
  paintLayer!({ dialog: false, team: true });
}

let banner: Promise<(on: boolean) => void> | null = null;

/** Shows the "Demo workspace" banner while the visitor explores the demo, hides it otherwise. */
async function paintBanner() {
  const slot = document.querySelector<HTMLElement>('[data-demo-strip]');
  if (!slot) return;
  const on = exploringDemo();
  if (!on && !banner) return;
  banner ??= (async () => {
    const [{ createElement }, { createRoot }, { DemoBanner }] = await Promise.all([import('react'), import('react-dom/client'), import('../components/ds/studio/DemoBanner')]);
    const root = createRoot(slot);
    return (show: boolean) => {
      slot.hidden = !show;
      root.render(show ? createElement(DemoBanner, { repoUrl: `https://github.com/${deps!.repo()}`, onUseOwn: () => void openUseOwnRepo() }) : null);
    };
  })();
  (await banner)(exploringDemo());
}

/** Wires the gate once per page. */
export function bindDemoGate(d: DemoGateDeps) {
  if (deps) {
    deps = d;
    return;
  }
  deps = d;
  d.subscribe(() => void paintBanner());
  void paintBanner();
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>('[data-demo-write], [data-gh-gate]');
      if (!el || !exploringDemo()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      target?.closest('details')?.removeAttribute('open');
      void openMakeItYours();
    },
    true,
  );
}
