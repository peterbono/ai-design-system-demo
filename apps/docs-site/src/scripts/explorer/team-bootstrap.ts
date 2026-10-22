// Studio Tokens on a team shell (multi-team PR 3b): reads the team's repo model (scripts/team-data.ts), writes the
// data blocks the explorer and the token editor read (explorer/data.ts writeExplorerData), gives the brand and density
// menus the team's values, fills the palette list of the New token dialog, then starts the explorer. While it reads,
// the page shows skeletons; a failure shows what went wrong and Try again; a repository without token files says
// where Bridge looked and how to point it elsewhere. Repo text reaches the page as text nodes and attribute values only.
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Braces } from 'lucide-react';
import { EmptyState, Link } from '@bridge-ds/react';
import { buildTokenSet, layoutOptions, loadConfig } from '@bridge-ds/core';
import { TeamLoadError, TeamLoadProgress, TeamSourceNote } from '../../components/ds/studio/TeamState';
import { loadTeamData, resetTeamData, teamOfPage } from '../team-data';
import { HOSTED_DOCS_URL, teamFailure } from '../../lib/team-load';
import { teamDisplayName } from '../../lib/demo';
import { modeName } from '../../lib/explorer/format';
import { modesOf } from '../../lib/explorer/model';
import { explorerInputFromModel, writeExplorerData } from './data';

const treeUrl = (owner: string, repo: string, sha: string, dir: string) =>
  `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${encodeURIComponent(sha)}/${dir.split('/').map(encodeURIComponent).join('/')}`;

/** Gives a static SegmentedControl one segment per value, cloned from its first (placeholder) segment. */
export function fillSegments(root: Element | null, values: string[], label: (v: string) => string) {
  const track = root?.querySelector('[data-segment-track]') ?? root;
  const first = track?.querySelector<HTMLElement>('[data-segment]');
  if (!track || !first) return;
  const segments = values.map((v, i) => {
    const seg = first.cloneNode(true) as HTMLElement;
    seg.dataset.value = v;
    seg.setAttribute('aria-checked', String(i === 0));
    seg.tabIndex = i === 0 ? 0 : -1;
    const text = [...seg.querySelectorAll('span')].pop() ?? seg;
    text.textContent = label(v);
    return seg;
  });
  track.querySelectorAll('[data-segment]').forEach((s) => s.remove());
  track.append(...segments);
}

let stateRoot: Root | null = null;
let sourceRoot: Root | null = null;

/** Reads the team, then calls `start` (initTokenExplorer) once the data blocks are in the page. */
export async function bootstrapTeamExplorer(start: () => void): Promise<void> {
  const xp = document.querySelector<HTMLElement>('[data-hosted-explorer]');
  const state = document.querySelector<HTMLElement>('[data-xp-team-state]');
  if (!xp || !state) return;
  const team = teamOfPage();
  const name = team ? teamDisplayName(`${team.owner}/${team.repo}`) : 'this repository';
  const paint = (node: ReturnType<typeof createElement>) => {
    state.removeAttribute('aria-busy');
    state.classList.remove('lp-wait');
    stateRoot ??= createRoot(state);
    stateRoot.render(node);
  };
  // How far the read has gone, until the tokens are in (or it fails).
  stateRoot ??= createRoot(state);
  stateRoot.render(createElement(TeamLoadProgress, { label: "Reading the team's tokens" }));

  let data: Awaited<ReturnType<typeof loadTeamData>>;
  try {
    data = await loadTeamData();
  } catch (err) {
    paint(
      createElement(TeamLoadError, {
        failure: teamFailure(err, name),
        onRetry: () => {
          resetTeamData();
          location.reload();
        },
      }),
    );
    return;
  }

  const { model } = data;
  if (!Object.keys(model.tokens.files).length) {
    paint(
      createElement(EmptyState, {
        size: 'lg',
        headingLevel: 2,
        icon: Braces,
        align: 'start',
        title: `No token files in ${model.tokens.root}`,
        description: `Bridge reads DTCG token files from tokens.root in bridge.config.json, and found none at ${model.tokens.root} in ${name}. Point tokens.root at the folder that holds them, then refresh.`,
        actions: createElement(Link, { href: HOSTED_DOCS_URL, target: '_blank', rel: 'noopener noreferrer' }, 'How Bridge reads a repository'),
      }),
    );
    return;
  }

  const input = explorerInputFromModel(model, { owner: data.owner, repo: data.repo, defaultBranch: data.defaultBranch, componentHref: (dir) => treeUrl(data.owner, data.repo, data.sha, dir) });
  writeExplorerData(input);
  const modes = modesOf(buildTokenSet(input.files, layoutOptions(loadConfig(input.config))));
  fillSegments(xp.querySelector('[data-xp-brand]'), modes.brands, (b) => model.tokens.rows.brandLabels[b] ?? modeName(b));
  fillSegments(xp.querySelector('[data-xp-density]'), modes.densities, modeName);
  const palette = document.getElementById('ed-palette');
  if (palette) {
    palette.replaceChildren(
      ...model.tokens.rows.brand
        .filter((t) => t.type === 'color')
        .map((t) => {
          const o = document.createElement('option');
          o.value = t.path;
          return o;
        }),
    );
  }
  const source = xp.querySelector<HTMLElement>('[data-xp-team-source]');
  if (source) {
    sourceRoot ??= createRoot(source);
    sourceRoot.render(
      createElement(TeamSourceNote, {
        data,
        refreshing: false,
        onRefresh: () => {
          resetTeamData();
          location.reload();
        },
      }),
    );
  }
  stateRoot?.unmount();
  stateRoot = null;
  (state.closest('[data-xp-team-wrap]') ?? state).remove();
  xp.hidden = false;
  start();
}
