// Settings > Your AI tools, for admins: one quiet line about the team's Bridge Library in Claude Design
// (lib/claude-design.ts), "Claude Design: Bridge Library 1.8.4 · Update available", with "Copy the request for
// Claude" on the same line. Hidden for everyone else, and while the site serves no Library.
import { useEffect, useState } from 'react';
import { Button } from '@bridge-ds/react';
import { CLAUDE_DESIGN_WORDS, claudeDesignLine, parseServedLibrary, type ServedLibrary, type TeamLibraryInClaude } from '../../../lib/claude-design';
import { useCopy } from './TeamLink';

export const MANIFEST_URL = '/claude-design-system/manifest.json';

export interface ClaudeDesignLineViewProps {
  admin: boolean;
  served: ServedLibrary | null;
  team: TeamLibraryInClaude | null;
}

export function ClaudeDesignLineView({ admin, served, team }: ClaudeDesignLineViewProps) {
  const { said, copy } = useCopy();
  const line = claudeDesignLine({ admin, served, team });
  if (!line) return null;
  // The settings row: "Claude Design" | "Bridge Library 1.8.4 · Update available" | the copy action, on one line.
  return (
    <div className="set-row" data-claude-design={line.status}>
      <p className="set-row-label">{CLAUDE_DESIGN_WORDS.label}</p>
      <div className="set-row-value">
        <p>{line.value}</p>
        {line.request && (
          <span role="status" className="set-row-help">
            {said}
          </span>
        )}
      </div>
      {line.request && (
        <div className="set-row-action">
          <Button variant="secondary" onClick={() => void copy(line.request!, CLAUDE_DESIGN_WORDS.copied)}>
            {CLAUDE_DESIGN_WORDS.copy}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Reads what the site serves and what the team keeps, once the viewer is known to be an admin of a real team. */
export default function ClaudeDesignLine({ admin, team }: { admin: boolean; team: string | null }) {
  const [served, setServed] = useState<ServedLibrary | null>(null);
  const [kept, setKept] = useState<TeamLibraryInClaude | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!admin || !team) return;
    let live = true;
    void (async () => {
      const [lib, design] = await Promise.all([
        fetch(MANIFEST_URL, { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : null))
          .then(parseServedLibrary)
          .catch(() => null),
        import('../../../scripts/entry-session').then((m) => m.getTeamClaudeDesign(team)).catch(() => undefined),
      ]);
      if (!live || design === undefined) return;
      setServed(lib);
      setKept(design);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [admin, team]);
  if (!ready) return null;
  return <ClaudeDesignLineView admin={admin} served={served} team={kept} />;
}
