// Studio, Being built: Claude's fixes. The fixes the team's connected Claude works on or has ready (api/claude,
// docs/FIGMA-FIXES.md "Claude runs it for the team"), above the build requests (pages/studio/building.astro and its team
// shell). Nothing shows when there is no run in the last 7 days, on the sample team, or when the site cannot say.
//   - A title and one sentence, then one row per run: the shared BranchRow (compact), the component, the server's
//     sentence and who asked, one status tag after the text ("Claude is on it", "Claude's fix is ready", "No fix
//     found", "Not finished"). A ready row opens the review of Claude's change in Studio, never GitHub; the others
//     open the component. With 3 ready fixes or fewer, each ready row also says "See Claude's fix" on its line.
//   - A run in progress moves while this page shows it: the page asks the server about one run at a time (each answer
//     is at most one Claude round), waits what the server says, and stops when the page is hidden or every run is done.
// Words: lib/claude-runs-view.ts, statuses from the server so the plugin and Studio say the same. Never `developer`.
import { useEffect, useRef, useState } from 'react';
import { Icon, Link } from '@bridge-ds/react';
import { Wrench } from 'lucide-react';
import { BranchRow } from './BranchRow';
import { CLAUDE_FIXES_WORDS as W, isFinal, MAX_ROW_LINKS, MAX_ROWS, parseRun, runLine, runPill, runRoute, type ClaudeRun } from '../../../lib/claude-runs-view';
import { isSampleTeam } from '../../../lib/demo';
import { studioHref } from '../../../lib/team-path';
import { repoContext } from '../../../scripts/repo-context';

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');

function useRuns(): ClaudeRun[] {
  const [runs, setRuns] = useState<ClaudeRun[]>([]);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const ctx = repoContext();
    const repo = `${ctx.owner}/${ctx.repo}`;
    if (noRepoPage() || isSampleTeam(repo)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sleep = (s: number) => new Promise<void>((r) => (timer = setTimeout(r, s * 1000)));
    void (async () => {
      let api: typeof import('../../../scripts/claude-api');
      let list: ClaudeRun[];
      try {
        api = await import('../../../scripts/claude-api');
        list = (await api.listClaudeRuns(repo)).map(parseRun).filter((r): r is ClaudeRun => Boolean(r)).slice(0, MAX_ROWS);
      } catch {
        return; // Not connected, not set up, signed out: nothing to show.
      }
      if (!live.current) return;
      setRuns(list);
      // One run at a time, while the page is shown, until each one is final.
      while (live.current) {
        const next = list.find((r) => !isFinal(r.status));
        if (!next) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          await sleep(5);
          continue;
        }
        let fresh: ClaudeRun | null = null;
        try {
          fresh = parseRun(await api.pollClaudeRun(repo, next.id));
        } catch {
          return; // The site stopped answering: the rows keep what they said.
        }
        if (!live.current) return;
        if (!fresh) return;
        list = list.map((r) => (r.id === fresh!.id ? fresh! : r));
        setRuns(list);
        if (!isFinal(fresh.status)) await sleep(fresh.retryAfter);
      }
    })();
    return () => {
      live.current = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return runs;
}

export default function ClaudeFixes() {
  const runs = useRuns();
  if (!runs.length) return null;
  const readyCount = runs.filter((r) => r.status === 'ready').length;
  return (
    <section className="bb-section bb-claude" aria-labelledby="bb-claude-title" aria-live="polite">
      <h2 className="t-ui bb-h" id="bb-claude-title">
        {W.title}
      </h2>
      <p className="t-ui t-muted bb-measure">{W.intro}</p>
      <ul className="sh-rows bb-rows" aria-label={W.listLabel}>
        {runs.map((r) => {
          const href = studioHref(runRoute(r));
          return (
            <BranchRow
              key={r.id}
              compact
              thumb={{ kind: 'icon', icon: 'component' }}
              who={
                <span className="bb-nobody">
                  <Icon icon={Wrench} size="sm" />
                </span>
              }
              title={r.component}
              href={href}
              line={runLine(r)}
              pill={runPill(r)}
              end={
                r.status === 'ready' && readyCount <= MAX_ROW_LINKS ? (
                  <Link href={href} className="t-ui bb-claude-see">
                    {W.see}
                  </Link>
                ) : undefined
              }
            />
          );
        })}
      </ul>
    </section>
  );
}
