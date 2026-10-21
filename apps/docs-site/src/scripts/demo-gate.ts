// On the demo (lib/demo.ts DEMO_REPOS), a visitor who cannot write to it explores freely: every action that would
// change it opens "Make it yours" (components/ds/studio/MakeItYours.tsx) instead of failing or asking for a GitHub
// sign-in out of context. Someone who can write to the demo (its owner) keeps the normal Studio.
//
// Which actions: any element marked [data-demo-write="<what it does>"] ("create branches", "approve changes"), and
// the actions the session gates while signed out ([data-gh-gate="<verb phrase>"]). One capture listener on the
// document, wired once by the shared GitHub session (scripts/github-session.ts initGitHubConnect), so it runs before
// the page's own handlers and before the session opens its sign-in dialog. The dialog's code loads on first use.
import { DEFAULT_WRITE, exploresDemo } from '../lib/demo';

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
}

let deps: DemoGateDeps | null = null;

/** True when this visitor explores the demo: write actions open "Make it yours". */
export function exploringDemo(): boolean {
  if (!deps || !deps.known()) return false;
  const login = deps.login();
  return exploresDemo({ repo: deps.repo(), signedIn: Boolean(login), write: login ? deps.write() : false });
}

let host: { render: (action: string | null) => void } | null = null;
let loading: Promise<void> | null = null;

/** Opens "Make it yours" for `action` ("create branches"); without one, as "Connect your design system" opens it. */
export async function openMakeItYours(action?: string | null): Promise<void> {
  if (!host) {
    loading ??= (async () => {
      const [{ createElement }, { createRoot }, { MakeItYours, teamAccessCheck }] = await Promise.all([
        import('react'),
        import('react-dom/client'),
        import('../components/ds/studio/MakeItYours'),
      ]);
      const el = document.createElement('div');
      el.dataset.makeItYours = '';
      document.body.append(el);
      const root = createRoot(el);
      let current: string | null = null;
      const paint = (open: boolean) =>
        root.render(
          createElement(MakeItYours, {
            open,
            onOpenChange: (o: boolean) => paint(o),
            action: current,
            login: deps?.login() ?? null,
            signIn: deps?.signIn() ?? true,
            check: teamAccessCheck,
          }),
        );
      host = {
        render: (a) => {
          current = a;
          paint(true);
        },
      };
    })();
    await loading;
  }
  host!.render(action ?? null);
}

/** Wires the gate once per page. */
export function bindDemoGate(d: DemoGateDeps) {
  if (deps) {
    deps = d;
    return;
  }
  deps = d;
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>('[data-demo-write], [data-gh-gate]');
      if (!el || !exploringDemo()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      target?.closest('details')?.removeAttribute('open');
      void openMakeItYours(el.dataset.demoWrite || el.dataset.ghGate || DEFAULT_WRITE);
    },
    true,
  );
}
