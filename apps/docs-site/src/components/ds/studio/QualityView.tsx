// Studio Quality, the page body shared by the self-hosted page (pages/studio/quality/index.astro) and the team page
// (TeamQuality.tsx). One story first: the verdict in the page's one Harbor zone, next to the lighthouse drawing whose
// weather follows it, with at most one action (only when something needs the viewer). Then the three pillars as one
// group of identical cards (accessibility, adoption, documentation), then one section per pillar in the same order,
// and the tokens last as a calm note. Details wait in DS Accordions: the contrast per brand and theme, adoption's
// earlier runs. Numbers and words: lib/quality-view.ts.
import type { ReactNode } from 'react';
import { Accordion, AccordionItem, Badge, Card, CardBody, Link, Progress } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import ContrastFailTable, { type ContrastFailRow } from './ContrastFailTable';
import { QuietScene } from './QuietScene';
import { ADOPTION_MEANING, type ComboResult, type Finding } from '../../../lib/quality';
import { HEALTH_SECTION } from '../../../lib/library-health';
import { pctLabel as formatPct, productTrend, runDate, unusedLine, type AdoptionRun, type AdoptionView, type Pillar, type Verdict } from '../../../lib/quality-view';
import { safeUrl } from '../../../lib/html';
import type { StatusGroup } from '../../../lib/changes';

const TONE: Record<StatusGroup, 'danger' | 'info' | 'success' | 'neutral'> = { blocked: 'danger', waiting: 'info', ready: 'success', neutral: 'neutral' };

/** Links that leave Bridge (GitHub) open in a new tab; Studio links stay. */
const external = (href: string) => (/^https?:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {});

export interface QualityViewProps {
  verdict: Verdict;
  pillars: Pillar[];
  contrast: {
    /** False when no contrast checks are set up: the gate row says so instead of the brand and theme list. */
    hasChecks: boolean;
    gate: Finding;
    combos: ComboResult[];
    failRows: ContrastFailRow[];
  };
  adoption: AdoptionView | null;
  /** Shown instead of the products when there is no audit (who turns it on). */
  adoptionEmpty?: ReactNode;
  guidance: { lead: string; findings: Finding[] };
  tokens: { findings: Finding[]; unusedTotal: number; unusedHref: string; problems?: string[] };
}

function Go({ href, label, title }: { href: string; label: string; title: string }) {
  const url = safeUrl(href, '#');
  return (
    <Link variant="standalone" className="ql-act" href={url} aria-label={`${label}: ${title}`} {...external(url)}>
      {label}
    </Link>
  );
}

/** One finding, one line: what, its status, the action on the same line (proximity). */
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

function VerdictZone({ verdict }: { verdict: Verdict }) {
  return (
    <section className="zone ql-verdict" data-mood={verdict.mood} aria-labelledby="ql-verdict-title">
      <QuietScene scene="lighthouse" mood={verdict.mood} width={256} className="ql-scene" />
      <div className="ql-verdict-text">
        <h2 id="ql-verdict-title" className="ql-verdict-title">
          {verdict.title}
        </h2>
        <p className="ql-verdict-sentence">{verdict.sentence}</p>
        {verdict.action && (
          <ButtonLink variant="primary" className="ql-cta" href={safeUrl(verdict.action.href, '#')} {...external(verdict.action.href)}>
            {verdict.action.label}
          </ButtonLink>
        )}
      </div>
    </section>
  );
}

/** "304 of 304" reads as one figure: the count in the display face, the total small after a slash. */
function PillarValue({ value }: { value: string }) {
  const m = /^(\S+) of (\S+)$/.exec(value);
  if (!m) return <>{value}</>;
  return (
    <>
      {m[1]}
      <span className="ql-pillar-of">
        <span aria-hidden="true">/</span>
        <span className="sr-only"> of </span>
        {m[2]}
      </span>
    </>
  );
}

/** What the number is made of: brand and theme tiles, each product's share, one dot per component. */
function PillarViz({ viz }: { viz: NonNullable<Pillar['viz']> }) {
  if (viz.kind === 'combos')
    return (
      <ul className="ql-viz ql-tiles" aria-label="Per brand and theme">
        {viz.items.map((c) => (
          <li key={c.label} className={c.pass === c.total ? 'ql-tile' : 'ql-tile is-fail'}>
            <span className="ql-tile-name">{c.label}</span>
            <span className="num">{c.pass === c.total ? c.total : `${c.pass}/${c.total}`}</span>
          </li>
        ))}
      </ul>
    );
  if (viz.kind === 'products')
    return (
      <ul className="ql-viz ql-shares" aria-label="Per product">
        {viz.items.map((p) => (
          <li key={p.name}>
            <span className="ql-share-name">{p.name}</span>
            <span className="ql-share-bar" aria-hidden="true">
              <span style={{ inlineSize: `${Math.max(0, Math.min(100, p.pct))}%` }} />
            </span>
            <span className="num ql-share-pct">{formatPct(p.pct)}</span>
          </li>
        ))}
      </ul>
    );
  const left = viz.total - viz.reviewed - viz.drafted;
  return (
    <div className="ql-viz">
      <span className="ql-dots" role="img" aria-label={`${viz.reviewed} reviewed, ${viz.drafted} drafted, ${left} missing`}>
        {Array.from({ length: viz.total }, (_, i) => (
          <span key={i} className={i < viz.reviewed ? 'is-ok' : i < viz.reviewed + viz.drafted ? 'is-draft' : undefined} />
        ))}
      </span>
      {viz.reviewed < viz.total ? (
        <span className="ql-dots-key">
          {viz.drafted ? <span className="is-draft">{viz.drafted} drafted</span> : null}
          {left ? <span>{left} missing</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** The three pillars: one card shape, aligned on one grid (similarity, common region). */
function Pillars({ pillars }: { pillars: Pillar[] }) {
  return (
    <ul className="ql-pillars" aria-label="Library health at a glance">
      {pillars.map((p) => (
        <li key={p.id}>
          <Card padding="compact" className="ql-pillar-card">
            <CardBody className={p.tone === 'fail' ? 'ql-pillar is-fail' : 'ql-pillar'}>
            <h3 className="ql-pillar-name">{p.name}</h3>
            <p className="ql-pillar-value">
              <PillarValue value={p.value} />
              {p.delta ? <span className="ql-pillar-delta">{p.delta}</span> : null}
            </p>
            <p className="ql-pillar-label">{p.label}</p>
            {p.viz ? (
              <PillarViz viz={p.viz} />
            ) : p.meter !== null ? (
              <Progress value={p.meter} size="sm" tone={p.tone === 'fail' ? 'danger' : 'signal'} aria-label={`${p.name}: ${p.value} ${p.label}`} className="ql-meter" />
            ) : (
              <span className="ql-meter-gap" aria-hidden="true" />
            )}
            {/* The picture already says what the sentence would; it stays when something fails or nothing is counted. */}
            {!p.viz || p.tone === 'fail' ? <p className="ql-pillar-sentence">{p.sentence}</p> : <span aria-hidden="true" />}
            <Link variant="standalone" className="ql-next" href={p.next.href}>
              {p.next.label}
            </Link>
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function ContrastSection({ contrast }: { contrast: QualityViewProps['contrast'] }) {
  const { gate } = contrast;
  const failing = contrast.failRows.length > 0;
  return (
    <section aria-labelledby={HEALTH_SECTION.contrast} className="ql-section">
      <h2 id={HEALTH_SECTION.contrast} className="ql-h">
        Accessibility
      </h2>
      {contrast.hasChecks ? (
        <>
          <p className="ql-muted ql-lead">Bridge checks every color pair in each brand and theme: text needs 4.5:1, edges and focus rings 3:1.</p>
          <Accordion multiple defaultValue={failing ? ['combos', 'failing'] : []} headingLevel={3} className="ql-acc">
            <AccordionItem value="combos" title="Each brand and theme" meta={<Badge tone={TONE[gate.status.group]}>{gate.status.label}</Badge>}>
              <ul className="ql-combos" aria-label="Contrast checks per brand and theme">
                {contrast.combos.map((c) => (
                  <li key={c.label}>
                    <span className="ql-combo-name">{c.label}</span>
                    <span className="num ql-detail">
                      {c.pass} of {c.total}
                    </span>
                    <Badge tone={c.pass === c.total ? 'success' : 'danger'} size="sm">
                      {c.pass === c.total ? 'Pass' : 'Fail'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </AccordionItem>
            {failing ? (
              <AccordionItem value="failing" title="The pairs that fail" meta={<span className="num">{contrast.failRows.length}</span>}>
                <ContrastFailTable rows={contrast.failRows} />
              </AccordionItem>
            ) : null}
          </Accordion>
          {gate.action && (
            <p className="ql-quiet">
              <Link href={safeUrl(gate.action.href, '#')} {...external(gate.action.href)}>
                {gate.action.label}
              </Link>
            </p>
          )}
        </>
      ) : (
        <ul className="fg-card ql-list">
          <FindingRow f={gate} />
        </ul>
      )}
    </section>
  );
}

function RunRow({ r }: { r: AdoptionRun }) {
  return (
    <li className="ql-run">
      <span className="ql-main">
        <span className="ql-title">{r.label}</span>
        <span className="ql-detail">Run {runDate(r.generatedAt)}</span>
      </span>
      <span className="ql-detail num">Tokens {formatPct(r.token)}</span>
      <span className="ql-detail num">Components {formatPct(r.component)}</span>
      <Go href={r.href} label="Open the report" title={r.label} />
    </li>
  );
}

function AdoptionSection({ adoption, empty }: { adoption: AdoptionView | null; empty?: ReactNode }) {
  return (
    <section aria-labelledby={HEALTH_SECTION.adoption} className="ql-section">
      <h2 id={HEALTH_SECTION.adoption} className="ql-h">
        Adoption
      </h2>
      {adoption ? (
        <>
          <p className="ql-muted ql-lead">{ADOPTION_MEANING}</p>
          <ul className="fg-card ql-list">
            {adoption.products.map((p) => {
              const trend = productTrend(p);
              return (
                <li key={p.product} className="ql-row-wrap">
                  <div className="ql-product">
                    <span className="ql-main">
                      <span className="ql-title">{p.name}</span>
                      <span className="ql-detail">
                        {trend ?? 'First audit.'} Run {runDate(p.latest.generatedAt)}.
                      </span>
                    </span>
                    {(['token', 'component'] as const).map((k) => (
                      <div key={k} className="ql-metric">
                        <span className="ql-detail">{k === 'token' ? 'Tokens' : 'Components'}</span>
                        <span className="ql-metric-value num">{formatPct(p.latest[k])}</span>
                        {p.latest[k] !== null && <Progress value={p.latest[k]} size="sm" aria-label={`${p.name}, ${k === 'token' ? 'tokens' : 'components'} from the design system: ${formatPct(p.latest[k])}`} />}
                      </div>
                    ))}
                    <Go href={p.latest.href} label="Open the report" title={p.name} />
                  </div>
                </li>
              );
            })}
          </ul>
          {adoption.earlier.length > 0 && (
            <Accordion headingLevel={3} className="ql-acc ql-earlier">
              <AccordionItem value="earlier" title="Earlier runs" meta={<span className="num">{adoption.earlier.length}</span>}>
                <p className="ql-muted">Before and after a migration, and products no longer audited. They stay for the record and do not count in the figure above.</p>
                <ul className="ql-runs">
                  {adoption.earlier.map((r) => (
                    <RunRow key={r.id} r={r} />
                  ))}
                </ul>
              </AccordionItem>
            </Accordion>
          )}
        </>
      ) : (
        empty
      )}
    </section>
  );
}

function GuidanceSection({ guidance }: { guidance: QualityViewProps['guidance'] }) {
  return (
    <section aria-labelledby={HEALTH_SECTION.guidance} className="ql-section">
      <h2 id={HEALTH_SECTION.guidance} className="ql-h">
        Documentation
      </h2>
      <p className="ql-muted ql-lead">{guidance.lead}</p>
      {guidance.findings.length > 0 && (
        <ul className="fg-card ql-list">
          {guidance.findings.map((f) => (
            <FindingRow key={f.id} f={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Tokens: what to fix first, then the unused ones as a calm note with the way to them. */
function TokensSection({ tokens }: { tokens: QualityViewProps['tokens'] }) {
  const problems = tokens.problems ?? [];
  return (
    <section aria-labelledby="ql-tokens" className="ql-section">
      <h2 id="ql-tokens" className="ql-h">
        Tokens
      </h2>
      {tokens.findings.length > 0 && (
        <ul className="fg-card ql-list ql-lead">
          {tokens.findings.map((f) => (
            <FindingRow key={f.id} f={f} />
          ))}
        </ul>
      )}
      <div className="fg-card ql-note">
        <span className="ql-main">
          <span className="ql-title">{unusedLine(tokens.unusedTotal)}</span>
          <span className="ql-detail">
            {tokens.unusedTotal ? 'Nothing breaks. They are candidates for cleanup, or values waiting for a job.' : 'Each token is read by a component or a stylesheet.'}
          </span>
        </span>
        {tokens.unusedTotal > 0 && <Go href={tokens.unusedHref} label="See unused tokens" title={unusedLine(tokens.unusedTotal)} />}
      </div>
      {problems.length > 0 && (
        <Accordion headingLevel={3} className="ql-acc ql-earlier">
          <AccordionItem value="problems" title={problems.length === 1 ? 'One thing Bridge could not read' : `${problems.length} things Bridge could not read`}>
            <ul className="ql-runs">
              {problems.map((p) => (
                <li key={p} className="ql-detail">
                  {p}
                </li>
              ))}
            </ul>
          </AccordionItem>
        </Accordion>
      )}
    </section>
  );
}

export function QualityView(props: QualityViewProps) {
  return (
    <>
      <VerdictZone verdict={props.verdict} />
      <Pillars pillars={props.pillars} />
      <ContrastSection contrast={props.contrast} />
      <AdoptionSection adoption={props.adoption} empty={props.adoptionEmpty} />
      <GuidanceSection guidance={props.guidance} />
      <TokensSection tokens={props.tokens} />
    </>
  );
}
