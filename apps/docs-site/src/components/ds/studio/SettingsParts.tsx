// Parts every Settings section shares (board D9):
//   DevFold        "For developers", closed by default, at the foot of a section's card: the repository, branch,
//                  file and key behind the designer sentence above it. Facts only, as a definition list.
//   AdminOnlyNote  the line a member who is not an admin reads under a setting: who can change it, by name ("Only Sam
//                  Rivera (admin) can change this."). It replaces a disabled control (BR-20).
import type { ReactNode } from 'react';
import { adminOnlyText } from '../../../lib/settings-view';
import { adminNames, useTeamPeople } from './members-state';

export interface DevFact {
  term: string;
  value: ReactNode;
  /** The value is code (a path, a key, a branch): mono. */
  code?: boolean;
}

export function DevFold({ facts, children }: { facts: DevFact[]; children?: ReactNode }) {
  return (
    <details className="set-more set-dev" data-dev-fold>
      <summary>
        <span className="set-more-title">For developers</span>
        <span className="set-chev" aria-hidden="true"></span>
      </summary>
      {children}
      <dl className="set-dev-facts">
        {facts.map((f) => (
          <div className="set-dev-fact" key={f.term}>
            <dt>{f.term}</dt>
            <dd>{f.code ? <code className="mono">{f.value}</code> : f.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** A value developers type or read in the code: mono. */
export const Code = ({ children }: { children: ReactNode }) => <code className="mono">{children}</code>;

/**
 * Who can change a setting, named, for a member who cannot. Nothing for an admin, or until Members has read the team
 * (with `fallback`: "Only an admin of this team can change this." meanwhile, for a reader of a setting with no control).
 */
export function AdminOnlyNote({ id, fallback = false }: { id?: string; fallback?: boolean }) {
  const people = useTeamPeople();
  if (!people) return fallback ? <p className="set-row-help set-admin-only" id={id}>{adminOnlyText([])}</p> : null;
  if (people.canManage || people.context !== 'real') return null;
  return (
    <p className="set-row-help set-admin-only" id={id}>
      {adminOnlyText(adminNames(people))}
    </p>
  );
}
