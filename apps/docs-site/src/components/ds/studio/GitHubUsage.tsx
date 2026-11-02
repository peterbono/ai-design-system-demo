// Settings, How changes reach your code: one calm row for the team's admins, how much of GitHub's hourly limit Bridge
// used for this team, so they know before pages slow down. Nothing for anyone else: the server answers admins only
// (api/mcp ?view=github-usage), and the row stays hidden on any other answer, on the sample team and before sign-in.
//   "Bridge used 1,240 of 5,000 GitHub reads this hour. Resets at 14:00."
//   "Bridge is close to GitHub's hourly limit for this team. Pages may load from the last saved copy until 14:00."
// A thin meter under the sentence, warning-toned when close or when GitHub asked Bridge to slow down this hour (the
// row's tone, so the slow-down is never only a muted help line). Words: lib/github-usage.ts.
import { useEffect, useState } from 'react';
import { Card, CardBody, Progress } from '@bridge-ds/react';
import { accessContext } from '../../../lib/library-access';
import { currentUsage, USAGE_WORDS as W, usageLines, type GitHubUsageView } from '../../../lib/github-usage';
import { repoContext } from '../../../scripts/repo-context';
import { currentContributor, signedInWithGitHub } from '../../../scripts/github-session';

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');

export default function GitHubUsage() {
  const [view, setView] = useState<GitHubUsageView | null>(null);

  useEffect(() => {
    const ctx = repoContext();
    const repo = `${ctx.owner}/${ctx.repo}`;
    if (accessContext(noRepoPage() ? null : repo, noRepoPage()) !== 'real') return;
    if (!signedInWithGitHub() && !currentContributor()) return;
    let live = true;
    void import('../../../scripts/connector-api')
      .then((api) => api.githubUsage(repo))
      .then(
        (v) => live && setView(v),
        () => live && setView(null),
      );
    return () => {
      live = false;
    };
  }, []);

  if (!view) return null;
  const now = Date.now();
  const lines = usageLines(view, now);
  const u = currentUsage(view, now);
  return (
    <Card id="github-usage">
      <CardBody>
        <div className="set-rows">
          <div className="set-row">
            <p className="set-row-label">{W.label}</p>
            <div className="set-row-value">
              <p>{lines.sentence}</p>
              {u && <Progress value={Math.min(u.used, u.limit)} max={u.limit} size="sm" tone={lines.tone === 'warning' ? 'warning' : 'signal'} aria-label={W.meter} showValue={false} className="set-usage-meter" />}
              {lines.help.map((h) => (
                <p className="set-row-help" key={h}>
                  {h}
                </p>
              ))}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
