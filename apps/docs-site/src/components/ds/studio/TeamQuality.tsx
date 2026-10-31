// Studio Quality for a team (multi-team PR 3b): the self-hosted page (pages/studio/quality/index.astro) as an island
// that reads the team's repository in the browser. A quiet line first (where the data was read, Share), then the page
// body shared with the self-hosted page (QualityView: the verdict with the lighthouse, the three pillars, one section
// each). Adoption comes from the team's Bridge snapshot, or says who turns it on. Numbers: lib/team-quality.ts. Repo
// content as React text only; repo links through safeUrl.
import { useEffect, useState } from 'react';
import { Accordion, AccordionItem, CodeBlock, Link } from '@bridge-ds/react';
import type { SnapshotAudit } from '@bridge-ds/core';
import { QualityShare } from './QualityShare';
import { QualityView } from './QualityView';
import { TeamLoadError, TeamLoadProgress, TeamSourceNote, useTeamData } from './TeamState';
import { loadTeamSnapshot } from '../../../scripts/team-data';
import { currentViewer, initGitHubConnect } from '../../../scripts/github-session';
import { viewerRoles } from '../../../lib/suggestions-view';
import { teamQuality, guidanceLead } from '../../../lib/team-quality';
import { ADOPTION_MEANING } from '../../../lib/quality';
import { HOSTED_DOCS_URL, SNAPSHOT_TEMPLATE_URL } from '../../../lib/team-load';
import { studioHref } from '../../../lib/team-path';

/** What a designer sends a developer to turn the adoption audit on (copied from the Quality page). */
export function auditAskMessage(repo: string): string {
  return `Could you turn on the adoption audit in Bridge for ${repo}? Copy the Bridge data workflow (${SNAPSHOT_TEMPLATE_URL}) into .github/workflows/ and add --audit "<folder>=<label>" to its bridge snapshot step, once per product folder. How it works: ${HOSTED_DOCS_URL}`;
}

/** The setup a developer does: the workflow and the audit flag, then a push. */
function AuditSetup() {
  return (
    <>
      <p>
        Copy the Bridge data workflow into <span className="mono">.github/workflows/</span> and add <span className="mono">--audit "&lt;folder&gt;=&lt;label&gt;"</span> to its{' '}
        <span className="mono">bridge snapshot</span> step, once per product folder. The results show here after the next push.
      </p>
      <p>
        <Link href={SNAPSHOT_TEMPLATE_URL} target="_blank" rel="noopener noreferrer">
          Get the workflow
        </Link>
        {' · '}
        <Link href={HOSTED_DOCS_URL} target="_blank" rel="noopener noreferrer">
          How the snapshot works
        </Link>
      </p>
    </>
  );
}

/**
 * No audit to show: what adoption is, and who turns it on. A tech owner reads what could not be found and gets the
 * setup; anyone else (a designer) reads that a developer turns it on, and the message to send them and the setup wait
 * in a "For developers" fold: no branch, workflow or flag in a designer's words.
 */
function NoAudit({ snapshot, repo, developer }: { snapshot: boolean; repo: string; developer: boolean }) {
  if (developer) {
    return (
      <div className="tp-locked">
        <p>
          <strong>No adoption audit yet.</strong>{' '}
          {snapshot ? 'Bridge read this repository\'s Bridge snapshot, and it carries no adoption audit.' : 'Bridge could not find a Bridge snapshot (the bridge-data branch) in this repository, and audits come from it.'}{' '}
          {ADOPTION_MEANING}
        </p>
        <AuditSetup />
      </div>
    );
  }
  return (
    <div className="tp-locked">
      <p>
        <strong>No adoption audit yet.</strong> {ADOPTION_MEANING} A developer of your team turns it on: the message to send them is under For developers.
      </p>
      <Accordion className="ql-dev" headingLevel={3}>
        <AccordionItem value="dev" title="For developers">
          <CodeBlock code={auditAskMessage(repo)} label="Message for a developer" wrap />
          <AuditSetup />
        </AccordionItem>
      </Accordion>
    </div>
  );
}

/** Studio Quality of the team in the address. SSR renders the skeleton; the browser reads the team. */
export default function TeamQuality() {
  const { load, retry } = useTeamData();
  // undefined: still looking; null: no snapshot; a list (maybe empty): the snapshot's audits.
  const [audits, setAudits] = useState<SnapshotAudit[] | null | undefined>(undefined);
  // When the snapshot was written: its own runs are the current products (lib/quality-view adoptionView).
  const [snapshotAt, setSnapshotAt] = useState<string | undefined>(undefined);
  const sha = load.status === 'ready' ? load.data.sha : null;
  // A tech owner sets the audit up; anyone else asks a developer (NoAudit).
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    initGitHubConnect((v) => setViewer(v?.login ?? null));
    setViewer(currentViewer()?.login ?? null);
  }, []);
  useEffect(() => {
    if (!sha) return;
    let live = true;
    void loadTeamSnapshot().then((s) => {
      if (!live) return;
      setSnapshotAt(s?.generatedAt);
      setAudits(s ? s.audits : null);
    });
    return () => {
      live = false;
    };
  }, [sha]);

  if (load.status === 'loading') return <TeamLoadProgress label="Reading the quality of this design system" />;
  if (load.status === 'error') return <TeamLoadError failure={load.failure} onRetry={retry} />;
  const { data, refreshing } = load;
  const developer = viewerRoles(viewer, data.model.config.governance.owners).includes('tech');
  const q = teamQuality({ model: data.model, owner: data.owner, repo: data.repo, sha: data.sha, audits: audits ?? null, ...(snapshotAt ? { snapshotAt } : {}), audience: developer ? 'developer' : 'designer' });
  return (
    <div className="ql">
      <div className="tq-top">
        <TeamSourceNote data={data} refreshing={refreshing} onRefresh={retry} />
        <QualityShare figures={q.figures} sentence={q.sentence} path={studioHref('quality/')} />
      </div>
      <QualityView
        verdict={q.verdict}
        pillars={q.pillars}
        contrast={{ hasChecks: q.hasChecks, gate: q.gate, combos: q.contrast.combos, failRows: q.failRows }}
        adoption={q.adoption}
        adoptionEmpty={audits === undefined ? <p className="ql-muted">Looking for the Bridge snapshot of this repository.</p> : <NoAudit snapshot={audits !== null} repo={`${data.owner}/${data.repo}`} developer={developer} />}
        guidance={{ lead: guidanceLead(q.guidance), findings: q.guidanceFindings }}
        tokens={{ findings: q.tokenFindings, unusedTotal: q.unusedTotal, unusedHref: q.unusedHref, problems: q.problems }}
      />
    </div>
  );
}
