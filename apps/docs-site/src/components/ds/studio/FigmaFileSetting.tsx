// Settings > Figma file: the Figma file the team's design system lives in (bridge.config.json `figma.file`, lib/figma-file.ts),
// on both Settings pages (self-hosted pages/studio/settings, in Figma and Claude; team shells pages/team-shell/settings,
// its own Figma band). One row like the team name: the label and what the file is for on the left, the value on the
// right. A lead or an admin with GitHub pastes the link in place, Save on the same line; Save opens the config pull
// request that sets `figma.file` (scripts/roles.ts proposeFigmaFile), like every config change from Studio. Everyone
// else reads it as a link to the file. Claude reads it (bridge_get_config) to link components to Figma.
import { useEffect, useState } from 'react';
import { Button, Card, CardBody, Input, Link } from '@bridge-ds/react';
import { figmaFileProblem } from '@bridge-ds/core';
import { isSampleTeam } from '../../../lib/demo';
import { FIGMA_FILE_WORDS, figmaFileLabel } from '../../../lib/figma-file';
import { libraryLead } from '../../../lib/create-branch';
import { studioHref } from '../../../lib/team-path';
import { AdminOnlyNote } from './SettingsParts';

export interface FigmaFileSettingProps {
  /** Branch prefix and protected branches from bridge.config.json, for the pull request (self-hosted page). */
  prefix?: string;
  protectedBranches?: string[];
}

interface Facts {
  repo: string;
  /** `figma.file` as the file says it; null when absent. */
  set: string | null;
}

export default function FigmaFileSetting({ prefix, protectedBranches }: FigmaFileSettingProps) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [lead, setLead] = useState(false);
  /** A lead signed in by email: the file is a GitHub change they cannot send (the email proxy refuses it). */
  const [emailLead, setEmailLead] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ number: number } | null>(null);

  useEffect(() => {
    let live = true;
    const read = () =>
      void import('../../../scripts/repo-context').then(({ repoContext, siteConfig }) => {
        if (!live) return;
        const r = repoContext();
        const set = (siteConfig() as { figma?: { file?: string } }).figma?.file?.trim() || null;
        setFacts({ repo: `${r.owner}/${r.repo}`, set });
        setValue(set ?? '');
      });
    read();
    document.addEventListener('bridge:team-model', read);
    void import('../../../scripts/github-session').then(({ onAccess }) => {
      onAccess((a) => {
        if (!live) return;
        setLead(libraryLead(a) && !a?.contributor);
        setEmailLead(Boolean(a?.contributor && a.admin));
      });
    });
    return () => {
      live = false;
      document.removeEventListener('bridge:team-model', read);
    };
  }, []);

  const editable = Boolean(facts) && lead && !isSampleTeam(facts?.repo);
  const changed = value.trim() !== (facts?.set ?? '');

  const save = async () => {
    const problem = figmaFileProblem(value);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const { proposeFigmaFile } = await import('../../../scripts/roles');
      // Kept if the person has to sign in again first: back on this page, it says to do it again.
      const keep = await import('../../../scripts/pending-action');
      keep.armPendingAction('retry', { label: 'send the Figma file' });
      const pr = await proposeFigmaFile(value, { prefix, protectedBranches });
      keep.disarmPendingAction();
      setSent({ number: pr.number });
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
              <p className="set-row-label" id="set-figma-file-label">
                {FIGMA_FILE_WORDS.label}
              </p>
              <p className="set-row-help" id="set-figma-file-help">
                {FIGMA_FILE_WORDS.help}
              </p>
            </div>
            {editable ? (
              <>
                <div className="set-row-value">
                  <Input
                    id="set-figma-file"
                    label={FIGMA_FILE_WORDS.label}
                    hideLabel
                    type="url"
                    inputMode="url"
                    aria-describedby="set-figma-file-help"
                    placeholder={FIGMA_FILE_WORDS.placeholder}
                    value={value}
                    autoComplete="off"
                    error={error ?? undefined}
                    onValueChange={(v: string) => {
                      setValue(v);
                      setError(null);
                    }}
                  />
                </div>
                <div className="set-row-action">
                  <Button type="submit" variant="secondary" loading={busy} disabled={busy || !changed || !value.trim()}>
                    Save
                  </Button>
                </div>
              </>
            ) : (
              <div className="set-row-value">
                {facts?.set ? (
                  <p className="set-who">
                    <Link href={facts.set.startsWith('http') ? facts.set : `https://www.figma.com/design/${encodeURIComponent(facts.set)}/`} external>
                      {figmaFileLabel(facts.set)}
                    </Link>
                  </p>
                ) : (
                  <p className="set-row-help">{FIGMA_FILE_WORDS.notSet}</p>
                )}
                {facts && !isSampleTeam(facts.repo) && (emailLead ? <p className="set-row-help">{FIGMA_FILE_WORDS.githubOnly}</p> : <AdminOnlyNote fallback={!facts.set} />)}
              </div>
            )}
          </div>
          {sent && (
            <div className="rq-done" role="status">
              <p>
                <strong>
                  {FIGMA_FILE_WORDS.requested}, #{sent.number}.
                </strong>{' '}
                {FIGMA_FILE_WORDS.applies}
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
