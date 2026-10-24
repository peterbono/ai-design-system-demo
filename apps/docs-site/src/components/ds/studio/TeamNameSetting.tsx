// Settings > General: the team's display name (bridge.config.json `name`, lib/team-name.ts), on both Settings pages
// (self-hosted pages/studio/settings, team shells pages/team-shell/settings). One row: the label and what the name is
// for on the left, the value on the right. An admin of the repository edits it in place, with Save on the same line;
// Save opens the config pull request that sets `name` (scripts/roles.ts proposeTeamName), like every config change
// from Studio. Everyone else reads it. The sample team (Acme Design) always reads its own name, read only.
// The name comes from the team's settings once read (scripts/repo-context.ts siteConfig, repainted on
// bridge:team-model); before that, and when the file has none, Bridge's name for it (lib/demo.ts teamDisplayName).
import { useEffect, useState } from 'react';
import { Button, Card, CardBody, Input, Link } from '@bridge-ds/react';
import { isSampleTeam, teamDisplayName } from '../../../lib/demo';
import { TEAM_NAME_WORDS, teamNameProblem } from '../../../lib/team-name';
import { studioHref } from '../../../lib/team-path';
import { AdminOnlyNote } from './SettingsParts';

export interface TeamNameSettingProps {
  /** Branch prefix and protected branches from bridge.config.json, for the pull request (self-hosted page). */
  prefix?: string;
  protectedBranches?: string[];
}

interface Facts {
  repo: string;
  /** `name` as the file says it; null when absent. */
  set: string | null;
}

function readFacts(r: { owner: string; repo: string }, c: { name?: string }): Facts {
  return { repo: `${r.owner}/${r.repo}`, set: c.name?.trim() || null };
}

export default function TeamNameSetting({ prefix, protectedBranches }: TeamNameSettingProps) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [admin, setAdmin] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ number: number; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    const read = () =>
      void import('../../../scripts/repo-context').then(({ repoContext, siteConfig }) => {
        if (!live) return;
        const f = readFacts(repoContext(), siteConfig());
        setFacts(f);
        setValue(teamDisplayName(f.repo, { name: f.set ?? undefined }));
      });
    read();
    document.addEventListener('bridge:team-model', read);
    void import('../../../scripts/github-session').then(({ onAccess }) => {
      onAccess((a) => live && setAdmin(Boolean(a?.admin || a?.repoAdmin)));
    });
    return () => {
      live = false;
      document.removeEventListener('bridge:team-model', read);
    };
  }, []);

  const shown = facts ? teamDisplayName(facts.repo, { name: facts.set ?? undefined }) : '';
  const editable = Boolean(facts) && admin && !isSampleTeam(facts?.repo);
  const changed = value.trim().replace(/\s+/g, ' ') !== (facts?.set ?? '');

  const save = async () => {
    const problem = teamNameProblem(value);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const { proposeTeamName } = await import('../../../scripts/roles');
      const pr = await proposeTeamName(value, { prefix, protectedBranches });
      setSent({ number: pr.number, name: value.trim() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardBody>
        <form
          className="set-rows"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (editable && changed && !busy) void save();
          }}
        >
          <div className="set-row">
            <div>
              <p className="set-row-label" id="set-team-name-label">
                {TEAM_NAME_WORDS.label}
              </p>
              <p className="set-row-help" id="set-team-name-help">
                {TEAM_NAME_WORDS.help}
              </p>
            </div>
            {editable ? (
              <>
                <div className="set-row-value">
                  <Input
                    id="set-team-name"
                    label={TEAM_NAME_WORDS.label}
                    hideLabel
                    aria-describedby="set-team-name-help"
                    value={value}
                    maxLength={60}
                    autoComplete="off"
                    error={error ?? undefined}
                    onValueChange={(v: string) => {
                      setValue(v);
                      setError(null);
                    }}
                  />
                </div>
                <div className="set-row-action">
                  <Button type="submit" variant="secondary" loading={busy} disabled={busy || !changed}>
                    Save
                  </Button>
                </div>
              </>
            ) : (
              <div className="set-row-value">
                <p className="set-who">{shown || ' '}</p>
                {facts && !isSampleTeam(facts.repo) && (facts.set ? <AdminOnlyNote fallback /> : <p className="set-row-help">{TEAM_NAME_WORDS.notSet}</p>)}
              </div>
            )}
          </div>
          {sent && (
            <div className="rq-done" role="status">
              <p>
                <strong>
                  {TEAM_NAME_WORDS.requested}, #{sent.number}.
                </strong>{' '}
                {sent.name}. {TEAM_NAME_WORDS.applies}
              </p>
              <p>
                <Link href={studioHref(`changes/?pr=${sent.number}`)}>See the change</Link>
              </p>
            </div>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
