// Studio Quality for a team (multi-team PR 3b): the self-hosted page (pages/studio/quality/index.astro) as an island
// that reads the team's repository in the browser. Summary first: where the data was read and Share, then the Harbor
// opener (the verdict, one primary, three figures), then one section per figure: contrast and tokens, adoption (from
// the team's Bridge snapshot, or how to publish one), guidance. Numbers: lib/team-quality.ts. Repo content as React
// text only; repo links through safeUrl.
import { useEffect, useState } from 'react';
import { Badge, Card, CardBody, Icon, Link } from '@bridge-ds/react';
import type { SnapshotAudit } from '@bridge-ds/core';
import { siteIcon } from '../../../brand/site-icons';
import ContrastFailTable from './ContrastFailTable';
import ButtonLink from '../ButtonLink';
import { QualityShare } from './QualityShare';
import { TeamLoadError, TeamLoadProgress, TeamSourceNote, useTeamData } from './TeamState';
import { loadTeamSnapshot } from '../../../scripts/team-data';
import { teamQuality, guidanceLead, pctLabel, type TeamQuality as Quality } from '../../../lib/team-quality';
import { ADOPTION_MEANING, cleanupTitle, type Finding } from '../../../lib/quality';
import { HEALTH_SECTION } from '../../../lib/library-health';
import { HOSTED_DOCS_URL, SNAPSHOT_TEMPLATE_URL } from '../../../lib/team-load';
import { safeUrl } from '../../../lib/html';
import { studioHref } from '../../../lib/team-path';
import type { StatusGroup } from '../../../lib/changes';

const TONE: Record<StatusGroup, 'danger' | 'info' | 'success' | 'neutral'> = { blocked: 'danger', waiting: 'info', ready: 'success', neutral: 'neutral' };

/** Links that leave Bridge (GitHub) open in a new tab; Studio links stay. */
const external = (href: string) => (/^https?:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {});

function Go({ href, label, title }: { href: string; label: string; title: string }) {
  const url = safeUrl(href, '#');
  return (
    <Link variant="standalone" className="ql-act" href={url} aria-label={`${label}: ${title}`} {...external(url)}>
      {label}
    </Link>
  );
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className={`ql-row-wrap is-${f.severity}`}>
      <div className="ql-row">
        <span className="ql-main">
          <span className="ql-title">{f.title}</span>
          {f.detail && <span className="ql-detail">{f.detail}</span>}
        </span>
        <Badge tone={TONE[f.status.group]} className="ql-badge">
          {f.status.label}
        </Badge>
        {f.action ? <Go href={f.action.href} label={f.action.label} title={f.title} /> : <span />}
      </div>
    </li>
  );
}

const Chevron = () => (
  <span className="ql-chev" aria-hidden="true">
    <Icon icon={siteIcon('chevron')} size="sm" className="icon" />
  </span>
);

const runDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
};

function Metric({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="am">
      <span className="am-label">{label}</span>
      <span className="am-value num">{pctLabel(value)}</span>
      {note && <span className="am-note">{note}</span>}
    </div>
  );
}

/** No audit to show: what adoption is, and the one way to get it here. */
function NoAudit({ snapshot }: { snapshot: boolean }) {
  return (
    <div className="tp-locked">
      <p>
        <strong>No adoption audit yet.</strong> {ADOPTION_MEANING}
      </p>
      <p>
        {snapshot ? 'The Bridge snapshot of this repository carries no audit. ' : 'Bridge reads audits from the Bridge snapshot, which this repository does not publish yet. '}
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
    </div>
  );
}

function QualityBody({ q, snapshot }: { q: Quality; snapshot: boolean | undefined }) {
  const { gate } = q;
  return (
    <>
      <section className="zone ql-open" aria-label="Library health">
        <div className="ql-open-head">
          <p className="ql-open-sentence">{q.sentence}</p>
          <ButtonLink variant="primary" className="ql-cta" href={safeUrl(q.cta.href, '#')} {...external(q.cta.href)}>
            {q.cta.label}
          </ButtonLink>
        </div>
        <ul className="ql-figs">
          {q.figures.map((f) => (
            <li key={f.id}>
              <Card interactive padding="compact">
                <CardBody className={f.tone === 'fail' ? 'ql-fig is-fail' : 'ql-fig'}>
                  <p className="ql-fig-value">{f.value}</p>
                  <p className="ql-fig-label">
                    <Link href={f.href} variant="subtle" data-card-primary="">
                      {f.label}
                    </Link>
                  </p>
                  <p className="ql-muted">{f.detail}</p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={HEALTH_SECTION.contrast}>
        <h2 id={HEALTH_SECTION.contrast} className="ql-h">
          Contrast and tokens
        </h2>
        <ul className="fg-card ql-list">
          {q.hasChecks ? (
            <li className={`ql-row-wrap is-${gate.severity}`}>
              <details className="ql-more" open={gate.severity === 'fail'}>
                <summary className="ql-row">
                  <span className="ql-main">
                    <span className="ql-title">Checks per brand and theme</span>
                    <span className="ql-detail">{gate.title}. Text needs 4.5:1, UI edges and focus rings 3:1.</span>
                  </span>
                  <Badge tone={TONE[gate.status.group]} className="ql-badge">
                    {gate.status.label}
                  </Badge>
                  <Chevron />
                </summary>
                <div className="ql-more-body">
                  <ul className="ql-combos" aria-label="Contrast checks per brand and theme">
                    {q.contrast.combos.map((c) => (
                      <li key={c.label}>
                        <span>{c.label}</span>
                        <span className="num">
                          {c.pass} of {c.total}
                        </span>
                        <Badge tone={c.pass === c.total ? 'success' : 'danger'} size="sm">
                          {c.pass === c.total ? 'Pass' : 'Fail'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  {q.failRows.length > 0 && <ContrastFailTable rows={q.failRows} />}
                  {gate.action && (
                    <p className="ql-muted">
                      <Link href={safeUrl(gate.action.href, '#')} {...external(gate.action.href)}>
                        {gate.action.label}
                      </Link>
                    </p>
                  )}
                </div>
              </details>
            </li>
          ) : (
            <FindingRow f={gate} />
          )}
          {q.tokenFindings.map((f) => (
            <FindingRow key={f.id} f={f} />
          ))}
          {q.cleanup.length > 0 && (
            <li className="ql-row-wrap is-note">
              <details className="ql-more">
                <summary className="ql-row">
                  <span className="ql-main">
                    <span className="ql-title">{cleanupTitle(q.unusedTotal)}</span>
                    <span className="ql-detail">Nothing breaks: candidates for cleanup, or values waiting for a job.</span>
                  </span>
                  <Badge className="ql-badge">Note</Badge>
                  <Chevron />
                </summary>
                <ul className="ql-more-body ql-cleanup">
                  {q.cleanup.map((i) => (
                    <li key={i.title}>
                      <Link href={safeUrl(i.href, '#')}>{i.title}</Link>
                      <span className="ql-detail">{i.detail}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )}
          {q.problems.length > 0 && (
            <li className="ql-row-wrap is-note">
              <details className="ql-more">
                <summary className="ql-row">
                  <span className="ql-main">
                    <span className="ql-title">{q.problems.length === 1 ? 'One thing Bridge could not read' : `${q.problems.length} things Bridge could not read`}</span>
                    <span className="ql-detail">The rest of the page leaves them out.</span>
                  </span>
                  <Badge className="ql-badge">Note</Badge>
                  <Chevron />
                </summary>
                <ul className="ql-more-body ql-cleanup">
                  {q.problems.map((p) => (
                    <li key={p}>
                      <span className="ql-detail">{p}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby={HEALTH_SECTION.adoption}>
        <h2 id={HEALTH_SECTION.adoption} className="ql-h">
          Adoption
        </h2>
        {q.adoption ? (
          <>
            <p className="ql-muted ql-lead">{ADOPTION_MEANING}</p>
            <ul className="fg-card ql-list">
              {q.adoption.map((a) => (
                <li key={a.id} className="ql-row-wrap">
                  <div className="ql-row ql-ad-row">
                    <span className="ql-title">{a.label}</span>
                    <Metric label="Tokens" value={a.token} note={`Run ${runDate(a.generatedAt)}`} />
                    <Metric label="Components" value={a.component} />
                    <Go href={a.href} label="Open the report" title={a.label} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : snapshot === undefined ? (
          <p className="ql-muted">Looking for the Bridge snapshot of this repository.</p>
        ) : (
          <NoAudit snapshot={snapshot} />
        )}
      </section>

      <section aria-labelledby={HEALTH_SECTION.guidance}>
        <h2 id={HEALTH_SECTION.guidance} className="ql-h">
          Guidance
        </h2>
        <p className="ql-muted ql-lead">{guidanceLead(q.guidance)}</p>
        {q.guidanceFindings.length > 0 && (
          <ul className="fg-card ql-list">
            {q.guidanceFindings.map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Studio Quality of the team in the address. SSR renders the skeleton; the browser reads the team. */
export default function TeamQuality() {
  const { load, retry } = useTeamData();
  // undefined: still looking; null: no snapshot; a list (maybe empty): the snapshot's audits.
  const [audits, setAudits] = useState<SnapshotAudit[] | null | undefined>(undefined);
  const sha = load.status === 'ready' ? load.data.sha : null;
  useEffect(() => {
    if (!sha) return;
    let live = true;
    void loadTeamSnapshot().then((s) => live && setAudits(s ? s.audits : null));
    return () => {
      live = false;
    };
  }, [sha]);

  if (load.status === 'loading') return <TeamLoadProgress label="Reading the quality of this design system" />;
  if (load.status === 'error') return <TeamLoadError failure={load.failure} onRetry={retry} />;
  const { data, refreshing } = load;
  const q = teamQuality({ model: data.model, owner: data.owner, repo: data.repo, sha: data.sha, audits: audits ?? null });
  return (
    <div className="ql">
      <div className="tq-top">
        <TeamSourceNote data={data} refreshing={refreshing} onRefresh={retry} />
        <QualityShare figures={q.figures} sentence={q.sentence} path={studioHref('quality/')} />
      </div>
      <QualityBody q={q} snapshot={audits === undefined ? undefined : audits !== null} />
    </div>
  );
}
