// Studio, Being built: Claude's fixes. What the team's Claude does through the Bridge connector on components that
// differ in Figma (the fix sessions, api/mcp ?view=sessions, docs/FIGMA-FIXES.md "Work in progress"), above the build
// requests. Nothing shows without a session in the last 7 days, on the sample team, or when the site cannot say.
//   - A title and one sentence, then one row per component: the shared BranchRow (compact), the last step, how long,
//     who asked, and one status tag ("Claude is working", "Ready for review", "Stopped", "Went quiet"). A ready row
//     opens the review of Claude's change in Studio (never GitHub); the others open the component. Its steps unfold
//     under the row (progressive disclosure): every step is a real Bridge tool call, never a percentage.
//   - While a session works, the page reads them again every 10 seconds (paused while the tab is hidden).
import { useEffect, useState } from 'react';
import { Icon, Link } from '@bridge-ds/react';
import { Wrench } from 'lucide-react';
import { BranchRow } from './BranchRow';
import { FIXES_WORDS as W, parseSession, reviewOf, sessionLine, sessionTag, type Session } from '../../../lib/claude-connector';
import { isSampleTeam } from '../../../lib/demo';
import { studioHref } from '../../../lib/team-path';
import { repoContext } from '../../../scripts/repo-context';

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');
const MAX_ROWS = 6;
const POLL_MS = 10_000;
const slug = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const clock = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
};

function useSessions(): Session[] {
  const [list, setList] = useState<Session[]>([]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctx = repoContext();
    const repo = `${ctx.owner}/${ctx.repo}`;
    if (noRepoPage() || isSampleTeam(repo)) return;
    const read = async () => {
      if (!live) return;
      let next: Session[] | null = null;
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        try {
          const api = await import('../../../scripts/connector-api');
          next = (await api.listFixSessions(repo)).map(parseSession).filter((s): s is Session => Boolean(s)).slice(0, MAX_ROWS);
        } catch {
          return; // No connector here, signed out: nothing to show, and no more asking.
        }
        if (!live) return;
        setList(next);
      }
      if (!next || next.some((s) => s.state === 'working')) timer = setTimeout(() => void read(), POLL_MS);
    };
    void read();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return list;
}

export default function ClaudeFixes() {
  const sessions = useSessions();
  if (!sessions.length) return null;
  return (
    <section className="bb-section bb-claude" aria-labelledby="bb-claude-title">
      <h2 className="t-ui bb-h" id="bb-claude-title">
        {W.title}
      </h2>
      <p className="t-ui t-muted bb-measure">{W.intro}</p>
      <ul className="sh-rows bb-rows" aria-label={W.title} aria-live="polite">
        {sessions.map((s) => {
          const review = reviewOf(s);
          const href = studioHref(review && s.state === 'ready' ? review : `components/?c=${encodeURIComponent(slug(s.component))}`);
          return (
            <BranchRow
              key={s.component}
              compact
              thumb={{ kind: 'icon', icon: 'component' }}
              who={
                <span className="bb-nobody">
                  <Icon icon={Wrench} size="sm" />
                </span>
              }
              title={s.component}
              href={href}
              line={sessionLine(s)}
              pill={sessionTag(s)}
              end={
                <span className="bb-claude-end">
                  {review && s.state === 'ready' && (
                    <Link href={href} className="t-ui bb-claude-see">
                      {W.see}
                    </Link>
                  )}
                  <details className="bb-claude-steps">
                    <summary className="t-ui" tabIndex={0}>{W.steps}</summary>
                    <ol className="t-ui">
                      {s.steps.map((x, i) => (
                        <li key={`${x.at}-${i}`}>
                          <span className="t-muted">{clock(x.at)}</span> {x.text}
                          {x.by ? <span className="t-muted"> ({x.by})</span> : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                </span>
              }
            />
          );
        })}
      </ul>
    </section>
  );
}
