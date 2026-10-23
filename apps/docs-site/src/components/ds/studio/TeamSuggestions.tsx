// Team Branches (team shell /studio/<owner>/<repo>/changes/): the team's open suggestions under its branches, as the
// same rows (BranchRow), so a suggestion reads like the work it is. Each opens in place (?suggestion=N, the
// SuggestionReview of scripts/suggestions.ts). Painted by scripts/team-branches.ts; nothing shows without any.
import { createRoot, type Root } from 'react-dom/client';
import { BranchRow } from './BranchRow';
import { Who } from './faces';
import { person, requesterPerson } from '../../../lib/home-model';
import type { SuggestionRow } from '../../../lib/team-branches';

const avatarOf = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=64`;

export function TeamSuggestions({ rows }: { rows: SuggestionRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="bl-group tb-suggestions" aria-labelledby="tb-sg-title">
      <h2 className="bl-h2" id="tb-sg-title">
        Suggestions <span className="bl-count">{rows.length}</span>
      </h2>
      <p className="t-ui t-muted tb-sg-lead">Changes proposed from Figma or Bridge. Once owners approve one, a developer applies it.</p>
      <ul className="sh-rows" aria-labelledby="tb-sg-title">
        {rows.map((r) => {
          // Who asked (the requester Bridge recorded), else the GitHub account that opened it.
          const who = (r.requester && requesterPerson(r.requester, (l) => person(l, null, avatarOf(l)))) ?? person(r.author, null, avatarOf(r.author));
          return (
            <BranchRow
              key={r.number}
              thumb={r.thumb}
              who={<Who p={who} size="md" />}
              title={r.title}
              line={who.name}
              href={`?suggestion=${r.number}`}
              linkAttributes={{ 'data-open-suggestion': r.number }}
              pill={r.pill}
            />
          );
        })}
      </ul>
    </section>
  );
}

let root: Root | null = null;

export function paintTeamSuggestions(el: HTMLElement, rows: SuggestionRow[]) {
  root ??= createRoot(el);
  root.render(<TeamSuggestions rows={rows} />);
  el.hidden = !rows.length;
}
