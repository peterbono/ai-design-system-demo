// Team pages (multi-team PR 3b): a glimpse of a team's tokens, drawn from their resolved values (lib/token-specimens.ts):
// colour swatches, a type ramp, radius, space and shadow, each labelled with its token path. Shown when the team has no
// Storybook: tokens only, never components (Bridge cannot run another team's component code). Values reach inline
// styles only, through safeSpecimenValue; labels are React text.
import type { CSSProperties } from 'react';
import type { SpecimenSet } from '../../../lib/token-specimens';

const Label = ({ path, value }: { path: string; value?: string }) => (
  <span className="tsp-label">
    <span className="mono tsp-path">{path}</span>
    {value && <span className="mono tsp-value">{value}</span>}
  </span>
);

export default function TokenSpecimens({ set }: { set: SpecimenSet }) {
  if (!set.total) return null;
  const family: CSSProperties | undefined = set.family ? { fontFamily: set.family } : undefined;
  return (
    <section className="tsp" aria-labelledby="tsp-title">
      <h2 id="tsp-title" className="tsp-title">
        Tokens
      </h2>
      {set.color.length > 0 && (
        <ul className="tsp-colors" aria-label="Colors">
          {set.color.map((s) => (
            <li key={s.path} className="tsp-color">
              <span className="tsp-swatch" style={{ background: s.value }} aria-hidden="true" />
              <Label path={s.path} value={s.value} />
            </li>
          ))}
        </ul>
      )}
      <div className="tsp-groups">
        {set.type.length > 0 && (
          <ul className="tsp-group" aria-label="Type sizes">
            {set.type.map((s) => (
              <li key={s.path} className="tsp-type">
                <span className="tsp-sample" style={{ ...family, fontSize: s.value }} aria-hidden="true">
                  Ag
                </span>
                <Label path={s.path} value={s.value} />
              </li>
            ))}
          </ul>
        )}
        {set.radius.length > 0 && (
          <ul className="tsp-group" aria-label="Radius">
            {set.radius.map((s) => (
              <li key={s.path} className="tsp-row">
                <span className="tsp-radius" style={{ borderRadius: s.value }} aria-hidden="true" />
                <Label path={s.path} value={s.value} />
              </li>
            ))}
          </ul>
        )}
        {set.space.length > 0 && (
          <ul className="tsp-group" aria-label="Space">
            {set.space.map((s) => (
              <li key={s.path} className="tsp-row">
                <span className="tsp-space-track" aria-hidden="true">
                  <span className="tsp-space" style={{ width: s.value }} />
                </span>
                <Label path={s.path} value={s.value} />
              </li>
            ))}
          </ul>
        )}
        {set.shadow.length > 0 && (
          <ul className="tsp-group" aria-label="Shadows">
            {set.shadow.map((s) => (
              <li key={s.path} className="tsp-row">
                <span className="tsp-shadow" style={{ boxShadow: s.value }} aria-hidden="true" />
                <Label path={s.path} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
