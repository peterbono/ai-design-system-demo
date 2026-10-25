// On the demo (lib/demo.ts DEMO_REPOS), a visitor who cannot write to it explores freely (boards D1, D2 and EmptyA2):
//   - the one banner over every Studio and Library page (components/ds/studio/DemoBanner.tsx), with one action: on the
//     sample team "Get started" (the email sign-in), or "Back to your workspace" for someone signed in to Bridge;
//   - every action that would change the demo opens the demo dialog (components/ds/studio/MakeItYours.tsx): on the
//     sample team "This is a sample team." with the same "Get started", never a GitHub sign-in out of context.
//     Approve is the exception there: it can be tried, and shows its result without writing (scripts/reviews.ts).
// Someone who can write to the demo (its owner) keeps the normal Studio.
//
// Which actions: any element marked [data-demo-write="<what it does>"] ("create branches", "approve changes"), and
// the actions the session gates while signed out ([data-gh-gate="<verb phrase>"]). One capture listener on the
// document, wired once by the shared GitHub session (scripts/github-session.ts initGitHubConnect), so it runs before
// the page's own handlers and before the session opens its sign-in dialog. The React parts load on first use.
import { exploresDemo, isOwnTeam, isSampleTeam } from '../lib/demo';
import { repoContext } from './repo-context';

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

/**
 * A visitor on the sample team who is not signed in with GitHub: its buttons say what they do ("Send for review"),
 * never "Connect GitHub to...", since the sample team's one way in is "Get started" (and a click opens the demo
 * dialog). Synchronous, from the address: safe to call while painting a label.
 */
export function sampleVisitor(): boolean {
  const r = repoContext();
  return isSampleTeam(`${r.owner}/${r.repo}`) && !document.documentElement.hasAttribute('data-no-repo') && !deps?.login();
}

/** True when this visitor explores the demo: write actions open the demo dialog. */
export function exploringDemo(): boolean {
  if (!deps || !deps.known()) return false;
  // The start screen and the browser workspace are built on the demo's site but read no repository: never the demo.
  if (document.documentElement.hasAttribute('data-no-repo')) return false;
  const login = deps.login();
  return exploresDemo({ repo: deps.repo(), signedIn: Boolean(login), write: login ? deps.write() : false });
}

let paintLayer: ((open: boolean) => void) | null = null;
let loading: Promise<void> | null = null;

/** The demo dialog, mounted once in its own root at the end of the body. */
function layer(): Promise<void> {
  loading ??= (async () => {
    const [{ createElement }, { createRoot }, { MakeItYours }] = await Promise.all([import('react'), import('react-dom/client'), import('../components/ds/studio/MakeItYours')]);
    const el = document.createElement('div');
    el.dataset.demoLayer = '';
    document.body.append(el);
    const root = createRoot(el);
    paintLayer = (open) => root.render(createElement(MakeItYours, { open, onOpenChange: (o: boolean) => paintLayer!(o), signIn: deps?.signIn() ?? true, repo: deps?.repo() }));
  })();
  return loading;
}

/** Opens the demo dialog (board D2): "This is a sample team." on the sample team. */
export async function openMakeItYours(): Promise<void> {
  await layer();
  paintLayer!(true);
}

let banner: Promise<(on: boolean) => void> | null = null;

/** Where the banner's one action leads (DemoBanner.tsx): null is "Get started", for a visitor who has not started. */
async function bannerBack(repo: string): Promise<{ href: string; connect: boolean } | null> {
  const [{ startFacts }, { demoBack }, { loadReserved }, { getAccount }, { defaultNext }] = await Promise.all([
    import('./start'),
    import('../lib/start'),
    import('../lib/team-open'),
    import('./account-session'),
    import('../lib/account'),
  ]);
  const facts = startFacts();
  if (isOwnTeam(repo)) return demoBack(facts, await loadReserved());
  // The sample team: someone signed in to Bridge goes back to their own team; anyone else gets started.
  const { account } = await getAccount().catch(() => ({ account: null }));
  if (!account) return null;
  return account.teams.length ? { href: defaultNext(account, facts.recent), connect: false } : demoBack(facts, await loadReserved());
}

/** Paints the demo banner into the layout's [data-demo-strip] when `show`, hides it otherwise. */
async function paintStrip(show: boolean, repo: string) {
  const slot = document.querySelector<HTMLElement>('[data-demo-strip]');
  if (!slot) return;
  if (!show && !banner) return;
  banner ??= (async () => {
    const [{ createElement }, { createRoot }, { DemoBanner }, { connectDesignSystem }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../components/ds/studio/DemoBanner'),
      import('./start-connect'),
    ]);
    const root = createRoot(slot);
    // Read once per page from this browser and the account (no GitHub call).
    const back = await bannerBack(repo);
    return (on: boolean) => {
      slot.hidden = !on;
      document.documentElement.toggleAttribute('data-demo-visit', on && isSampleTeam(repo));
      // A built "Connect GitHub to..." button says what it does instead on the sample team ([data-demo-label]).
      if (on && isSampleTeam(repo))
        document.querySelectorAll<HTMLElement>('[data-demo-write][data-demo-label]').forEach((el) => {
          (el.querySelector<HTMLElement>(':scope > span') ?? el).textContent = el.dataset.demoLabel ?? '';
          el.removeAttribute('data-gh-open');
        });
      root.render(on ? createElement(DemoBanner, { repo, back, onConnect: connectDesignSystem }) : null);
    };
  })();
  (await banner)(show);
}

/** Shows the demo banner while the visitor explores the demo, hides it otherwise. */
const paintBanner = () => paintStrip(exploringDemo(), deps!.repo());

/**
 * The sample team's Library: the same banner, for everyone (the Library is read only for all, so its owner sees it
 * too). Called by scripts/library-team.ts on a team Library page.
 */
export function paintLibraryBanner(repo: string) {
  if (isSampleTeam(repo)) void paintStrip(true, repo);
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
