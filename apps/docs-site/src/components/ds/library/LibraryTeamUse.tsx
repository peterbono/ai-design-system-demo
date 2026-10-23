// A team's Library, Use pages (src/pages/library-shell/install|agents|how-review-works|changelog/): the same views as
// Bridge's own pages, fed with what the team publishes. Install: the packages its snapshot lists. Agents: the
// llms.txt it publishes next to the snapshot, and the Bridge MCP server pointed at its repository. How review works:
// its own docs/GOVERNANCE.md and AGENTS.md (bridge.config.json docs), else its governance config. Changelog: the
// releases its snapshot carries. `bridge` (the Bridge tools: CLI, MCP server, Figma plugin) comes from this site's
// build, as props of the island.
import { useEffect, useState, type ComponentType } from 'react';
import type { RepoSnapshot } from '@bridge-ds/core';
import { LibraryPage, LibrarySourceNote, LibraryZone } from './LibraryState';
import { teamLibraryData, type BridgeTools, type LibraryData, type UseExtras } from './library-data';
import InstallView, { INSTALL_PAGE } from './views/InstallView';
import AgentsView, { AGENTS_PAGE } from './views/AgentsView';
import ReviewView, { REVIEW_PAGE } from './views/ReviewView';
import ChangelogView, { CHANGELOG_PAGE } from './views/ChangelogView';
import { agentPrChecksOf, agentRulesOf, approvalsOf, reviewGatesOf, riskTiersOf } from '../../../lib/library/use-pages';
import { llmsTxtUrl } from '../../../lib/library-view';
import type { IllustrationName } from '../../../brand/illustrations';
import { loadTeamLlmsText, loadTeamSnapshot, readTeamFile, resetTeamData, type TeamData } from '../../../scripts/team-data';
import '../../../styles/process.css';
import '../../../styles/connect.css';
import '../../../styles/library.css';
import '../../../styles/review-guide.css';

export type LibraryUsePage = 'install' | 'agents' | 'review' | 'changelog';

interface PageDef {
  view: ComponentType<{ data: LibraryData }>;
  title: string;
  art: IllustrationName;
  lead: string;
  label: string;
}

const PAGES: Record<LibraryUsePage, PageDef> = {
  install: { view: InstallView, ...INSTALL_PAGE, lead: 'Its packages from npm, its modes, the bridge CLI and the DS Bridge Figma plugin.', label: 'Reading the packages' },
  agents: { view: AgentsView, ...AGENTS_PAGE, lead: 'The MCP server, the bridge CLI and llms.txt, for AI agents.', label: 'Reading llms.txt' },
  review: { view: ReviewView, ...REVIEW_PAGE, lead: 'Risk tiers, review gates, the owner override and the rules the AI agent follows.', label: 'Reading the review rules' },
  changelog: { view: ChangelogView, ...CHANGELOG_PAGE, lead: 'What changed in each release and what it means for you.', label: 'Reading the releases' },
};

/** A refresh starts the page over: the page scripts bound to this view's markup start with the new one. */
const reload = () => {
  resetTeamData();
  location.reload();
};

/** What only some pages read, loaded for the page that shows it. */
async function loadUse(page: LibraryUsePage, d: TeamData): Promise<Partial<UseExtras> & { releases?: LibraryData['extras']['releases'] }> {
  if (page === 'install' || page === 'changelog') {
    const snap: RepoSnapshot | null = await loadTeamSnapshot();
    return {
      ...(snap?.packages ? { packages: snap.packages.filter((p) => !p.private).map((p) => ({ name: p.name, version: p.version })) } : {}),
      ...(snap?.releases ? { releases: snap.releases } : {}),
    };
  }
  if (page === 'agents') {
    const text = await loadTeamLlmsText();
    return { llms: text ? { text, href: llmsTxtUrl(d.owner, d.repo, d.private) } : null };
  }
  const docs = d.model.config.docs ?? {};
  const [gov, agents] = await Promise.all([readTeamFile(d, docs.governance ?? ''), readTeamFile(d, docs.guidelines ?? '')]);
  return {
    governance: {
      ...(gov ? { tiers: riskTiersOf(gov), approvals: approvalsOf(gov), gates: reviewGatesOf(gov), agentPrs: agentPrChecksOf(gov) } : {}),
      ...(agents ? { rules: agentRulesOf(agents) } : {}),
    },
  };
}

function Ready({ page, data, bridge, refreshing }: { page: LibraryUsePage; data: TeamData; bridge: BridgeTools; refreshing: boolean }) {
  const [extra, setExtra] = useState<Awaited<ReturnType<typeof loadUse>> | null>(null);
  useEffect(() => {
    let live = true;
    void loadUse(page, data).then((x) => live && setExtra(x));
    return () => {
      live = false;
    };
    // Once per page: a refresh reloads it (reload above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!extra) return;
    void (async () => {
      const shell = await import('../../../scripts/shell');
      if (page === 'review') (await import('../../../scripts/use-pages')).initReviewPage();
      shell.paintStaticSegments();
      shell.initToc();
    })();
  }, [extra, page]);
  const base = teamLibraryData(data);
  const { releases, ...use } = extra ?? {};
  const view: LibraryData = { ...base, extras: { ...base.extras, ...(releases ? { releases } : {}), use: { bridge, ...use } } };
  const View = PAGES[page].view;
  return (
    <>
      {extra ? (
        <div>
          <View data={view} />
        </div>
      ) : (
        <LibraryZone title={PAGES[page].title} lead={PAGES[page].lead} art={PAGES[page].art} />
      )}
      <LibrarySourceNote data={data} refreshing={refreshing} onRefresh={reload} />
    </>
  );
}

export default function LibraryTeamUse({ page, bridge }: { page: LibraryUsePage; bridge: BridgeTools }) {
  const def = PAGES[page];
  return (
    <LibraryPage
      label={def.label}
      // The page's own header comes with the view; while it reads, the same title and lead hold its place.
      header={(data) => (data ? null : <LibraryZone title={def.title} lead={def.lead} art={def.art} />)}
      ready={(data, r) => <Ready page={page} data={data} bridge={bridge} refreshing={r.refreshing} />}
    />
  );
}
