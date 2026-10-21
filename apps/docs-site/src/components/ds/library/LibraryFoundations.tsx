// A team's Library, Foundations (multi-team PR 4a): the team's visual language drawn from its resolved tokens, one
// section per kind (color, type, space, radius, shadow), each specimen labelled with its token path. Generic: Bridge
// draws values, never the team's components. Values reach inline styles only through safeSpecimenValue
// (lib/token-specimens.ts); labels are React text.
import type { CSSProperties, ReactNode } from 'react';
import { Link } from '@bridge-ds/react';
import { LibraryPage, LibrarySourceNote, LibraryZone, usePageTeam } from './LibraryState';
import { libraryFoundations } from '../../../lib/library-view';
import { libraryHref } from '../../../lib/library-shells';
import type { Specimen, SpecimenSet } from '../../../lib/token-specimens';
import type { TeamData } from '../../../scripts/team-data';
import '../../../styles/team-components.css';

const Label = ({ path, value }: { path: string; value?: string }) => (
  <span className="tsp-label">
    <span className="mono tsp-path">{path}</span>
    {value && <span className="mono tsp-value">{value}</span>}
  </span>
);

function Section({ id, title, lead, items, children }: { id: string; title: string; lead: string; items: Specimen[]; children: ReactNode }) {
  if (!items.length) return null;
  return (
    <section className="ltm-section" aria-labelledby={id}>
      <header className="ltm-section-head">
        <h2 id={id} className="ltm-h2">
          {title} <span className="ltm-muted num">{items.length}</span>
        </h2>
        <p className="ltm-muted">{lead}</p>
      </header>
      {children}
    </section>
  );
}

function Specimens({ set }: { set: SpecimenSet }) {
  const family: CSSProperties | undefined = set.family ? { fontFamily: set.family } : undefined;
  return (
    <>
      <Section id="ltm-color" title="Color" lead="The colors product code paints with, by role." items={set.color}>
        <ul className="tsp-colors ltm-colors" aria-label="Colors">
          {set.color.map((s) => (
            <li key={s.path} className="tsp-color">
              <span className="tsp-swatch" style={{ background: s.value }} aria-hidden="true" />
              <Label path={s.path} value={s.value} />
            </li>
          ))}
        </ul>
      </Section>
      <Section id="ltm-type" title="Typography" lead={set.family ? `Type sizes, set in ${set.family.split(',')[0]!.replace(/["']/g, '')}.` : 'Type sizes.'} items={set.type}>
        <ul className="tsp-group ltm-list" aria-label="Type sizes">
          {set.type.map((s) => (
            <li key={s.path} className="tsp-type">
              <span className="tsp-sample" style={{ ...family, fontSize: s.value }} aria-hidden="true">
                Ag
              </span>
              <Label path={s.path} value={s.value} />
            </li>
          ))}
        </ul>
      </Section>
      <Section id="ltm-space" title="Space" lead="Gaps and paddings, smallest first as the tokens list them." items={set.space}>
        <ul className="tsp-group ltm-list" aria-label="Space">
          {set.space.map((s) => (
            <li key={s.path} className="tsp-row">
              <span className="tsp-space-track" aria-hidden="true">
                <span className="tsp-space" style={{ width: s.value }} />
              </span>
              <Label path={s.path} value={s.value} />
            </li>
          ))}
        </ul>
      </Section>
      <Section id="ltm-radius" title="Radius" lead="Corner roundness of controls and containers." items={set.radius}>
        <ul className="tsp-group ltm-list" aria-label="Radius">
          {set.radius.map((s) => (
            <li key={s.path} className="tsp-row">
              <span className="tsp-radius" style={{ borderRadius: s.value }} aria-hidden="true" />
              <Label path={s.path} value={s.value} />
            </li>
          ))}
        </ul>
      </Section>
      <Section id="ltm-shadow" title="Shadow" lead="Elevation, from resting surfaces to overlays." items={set.shadow}>
        <ul className="tsp-group ltm-list" aria-label="Shadows">
          {set.shadow.map((s) => (
            <li key={s.path} className="tsp-row">
              <span className="tsp-shadow" style={{ boxShadow: s.value }} aria-hidden="true" />
              <Label path={s.path} />
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Ready({ data, refreshing, onRefresh }: { data: TeamData; refreshing: boolean; onRefresh: () => void }) {
  const set = libraryFoundations(data.model);
  return (
    <>
      {set.total === 0 ? (
        <p className="ltm-muted">Bridge found no color, type, space, radius or shadow tokens to draw. The Tokens page lists every token it read.</p>
      ) : (
        <Specimens set={set} />
      )}
      <p className="ltm-muted">
        Drawn at the {set.brand} brand, {set.theme} theme.{' '}
        <Link href={libraryHref(data.owner, data.repo, 'tokens/')}>See every token with its values</Link>
      </p>
      <LibrarySourceNote data={data} refreshing={refreshing} onRefresh={onRefresh} />
    </>
  );
}

export default function LibraryFoundations() {
  const team = usePageTeam();
  return (
    <LibraryPage
      label="Reading the foundations"
      header={() => <LibraryZone title="Foundations" art="foundations" lead={`The visual language of ${team ? `${team.owner}/${team.repo}` : 'this design system'}: color, type, space, radius and shadow, drawn from its tokens.`} />}
      ready={(data, r) => <Ready data={data} {...r} />}
    />
  );
}
