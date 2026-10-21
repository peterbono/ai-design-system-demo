// Team Review (team shell /studio/<owner>/<repo>/review/, multi-team): the self-hosted review queue
// (scripts/review-queue-page.ts) on the team's repository. The team's repo model is read first (scripts/team-data.ts,
// with its progress), because the queue and the branch review read the team's settings (owners, rights, mode) when
// they load. The repo facts the self-hosted page embeds at build time are then written into the page as JSON text
// (lib/team-review.ts teamReviewBlocks): contrast failures and guidance drafts (#home-static, #home-guidance), the
// contrast pairs (#bridge-contrast) and the repository (#bridge-branches). Then the same queue starts.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { TeamLoadError, TeamLoadProgress } from '../components/ds/studio/TeamState';
import { loadTeamData, resetTeamData, teamOfPage, type TeamData } from './team-data';
import { teamFailure } from '../lib/team-load';
import { teamReviewBlocks } from '../lib/team-review';

export async function initTeamReview(): Promise<void> {
  const state = document.querySelector<HTMLElement>('[data-tr-state]');
  const page = document.querySelector<HTMLElement>('[data-review-queue]');
  if (!state || !page) return;
  const stateRoot = createRoot(state);
  stateRoot.render(createElement(TeamLoadProgress, { label: "Reading this team's reviews" }));

  let data: TeamData;
  try {
    data = await loadTeamData();
  } catch (err) {
    const team = teamOfPage();
    state.classList.remove('lp-wait');
    state.removeAttribute('aria-busy');
    stateRoot.render(
      createElement(TeamLoadError, {
        failure: teamFailure(err, team ? `${team.owner}/${team.repo}` : 'this repository'),
        onRetry: () => {
          resetTeamData();
          location.reload();
        },
      }),
    );
    return;
  }

  for (const [id, value] of teamReviewBlocks(data)) {
    if (document.getElementById(id)) continue;
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = id;
    el.textContent = JSON.stringify(value);
    document.body.append(el);
  }
  // Loaded once the team's settings are known: reviews.ts reads them when it loads.
  const { initReviewQueue } = await import('./review-queue-page');
  stateRoot.unmount();
  state.remove();
  page.hidden = false;
  initReviewQueue();
}
