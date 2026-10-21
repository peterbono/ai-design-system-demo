// The team launcher on Studio home (multi-team plan 4.3), on the hosted deployment only (BRIDGE_HOSTED=1): one field
// that takes "owner/repo" or a GitHub address and opens that team's Studio, /studio/<owner>/<repo>/ (the escape form
// when a Studio page takes the pair, lib/team-path.ts teamHref). Nothing is read from GitHub here: the team page
// says what the visitor can do once it opens.
import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Card, CardBody, Icon, Input } from '@bridge-ds/react';
import { GitHubMark } from './brand-icons';
import { parseTeamInput, RESERVED_PATHS_URL, teamHref, type ReservedPaths, type TeamInputError } from '../../../lib/team-path';

/** What to fix, per error (Bridge voice: says how to fix it). */
export const TEAM_INPUT_ERRORS: Record<TeamInputError, string> = {
  empty: 'Enter a repository, like acme/design-system.',
  'no-repo': 'Add the repository after the owner, like acme/design-system.',
  'not-github': 'Bridge opens repositories on GitHub. Paste a github.com address or owner/repo.',
  invalid: 'That is not a GitHub repository name. Use owner/repo, like acme/design-system.',
};

/** The reserved pairs of this build, read once; null when they cannot be read (teamHref then uses the escape form). */
let reserved: Promise<ReservedPaths | null> | null = null;
function loadReserved(): Promise<ReservedPaths | null> {
  reserved ??= fetch(RESERVED_PATHS_URL)
    .then((r) => (r.ok ? (r.json() as Promise<ReservedPaths>) : null))
    .then((v) => (v && Array.isArray(v.pairs) ? v : null))
    .catch(() => null);
  return reserved;
}

export interface TeamLauncherProps {
  /** Where to go, swapped in tests. */
  go?: (href: string) => void;
}

export default function TeamLauncher({ go = (href) => location.assign(href) }: TeamLauncherProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseTeamInput(value);
    if (!parsed.ok) {
      setError(TEAM_INPUT_ERRORS[parsed.error]);
      input.current?.focus();
      return;
    }
    setBusy(true);
    go(teamHref(parsed.owner, parsed.repo, await loadReserved()));
  };

  return (
    <Card className="tl" aria-labelledby="tl-title" role="region">
      <CardBody className="tl-body">
        <div className="tl-text">
          <h2 id="tl-title" className="tl-title">
            Open your team's Bridge
          </h2>
          <p className="tl-lead">Enter your design system's GitHub repository, as owner/repo or its address. Your team opens the same link and signs in with GitHub.</p>
        </div>
        <form className="tl-form" onSubmit={submit} noValidate>
          <Input
            ref={input}
            id="tl-repo"
              label="GitHub repository"
            hideLabel
            prefix={<Icon icon={GitHubMark} size="sm" />}
            placeholder="owner/repo"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            onFocus={() => void loadReserved()}
            onValueChange={(v) => {
              setValue(v);
              if (error) setError(null);
            }}
            error={error ?? undefined}
          />
          <Button type="submit" variant="secondary" className="tl-open" iconEnd={ArrowRight} loading={busy} disabled={busy}>
            Open
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
