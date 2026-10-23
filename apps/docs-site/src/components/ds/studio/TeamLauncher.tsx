// The team launcher on Studio home (multi-team plan 4.3), on the hosted deployment only (BRIDGE_HOSTED=1): one field
// that takes "owner/repo" or a GitHub address and opens that team's Studio, /studio/<owner>/<repo>/ (the escape form
// when a Studio page takes the pair, lib/team-path.ts teamHref). The parsing, the error words and the address come from
// lib/team-open.ts, shared with the team chip's "Create a new team" dialog (NewTeamDialog.tsx). Nothing is read from
// GitHub here: the team page says what the visitor can do once it opens.
import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Card, CardBody, Icon, Input } from '@bridge-ds/react';
import { GitHubMark } from './brand-icons';
import { loadReserved, openTeamHref, readTeamField } from '../../../lib/team-open';

export interface TeamFieldProps {
  /** The input id, unique on the page. */
  id: string;
  /** The submit's words and weight. */
  action?: string;
  variant?: 'primary' | 'secondary';
  /** Added to the team address: the setup step to open there (?setup=name). */
  query?: string;
  /** Where to go, swapped in tests. */
  go?: (href: string) => void;
  /**
   * Runs before going, with the repository picked: a sentence keeps the person here with it as the field's error
   * (the team made in Bridge links the repository first, Onboarding.tsx WorkspaceRepo).
   */
  before?: (owner: string, repo: string) => Promise<string | null>;
}

/**
 * The repository field and its action on one line: "owner/repo" or a GitHub address opens that team's Studio. Shared
 * by the launcher below and the browser workspace's setup step 2 (Onboarding.tsx).
 */
export function TeamField({ id, action = 'Open', variant = 'secondary', query = '', go = (href) => location.assign(href), before }: TeamFieldProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = readTeamField(value);
    if (!parsed.ok) {
      setError(parsed.message);
      input.current?.focus();
      return;
    }
    setBusy(true);
    const refused = before ? await before(parsed.owner, parsed.repo) : null;
    if (refused) {
      setBusy(false);
      setError(refused);
      input.current?.focus();
      return;
    }
    go(`${await openTeamHref(parsed.owner, parsed.repo)}${query}`);
  };

  return (
    <form className="tl-form" onSubmit={submit} noValidate>
      <Input
        ref={input}
        id={id}
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
      <Button type="submit" variant={variant} className="tl-open" iconEnd={ArrowRight} loading={busy} disabled={busy}>
        {action}
      </Button>
    </form>
  );
}

export interface TeamLauncherProps {
  /** Where to go, swapped in tests. */
  go?: (href: string) => void;
}

export default function TeamLauncher({ go }: TeamLauncherProps) {
  return (
    <Card className="tl" aria-labelledby="tl-title" role="region">
      <CardBody className="tl-body">
        <div className="tl-text">
          <h2 id="tl-title" className="tl-title">
            Open your team's Bridge
          </h2>
          <p className="tl-lead">Enter your design system's GitHub repository, as owner/repo or its address. Your team opens the same link and signs in with GitHub.</p>
        </div>
        <TeamField id="tl-repo" go={go} />
      </CardBody>
    </Card>
  );
}
