// The Danger zone at the foot of a team's Settings, for its admins only (lib/delete-team.ts has the words):
//   a team made in Bridge     "Delete this team"
//   a repository's team       "Disconnect this team from Bridge": Bridge forgets it, the repository stays on GitHub
// One row (what it does on the left, the action on the same line), then a confirm dialog that asks for the team's
// name, typed exactly. Once done: the browser forgets the team (lib/recent-teams forgetTeamEverywhere) and goes to the
// person's next team, else the start page. The server (api/entry delete-team) checks the admin again.
//   DeleteTeamRow    the row and its dialog, for a known team and an admin (TeamKeySettings renders it in its band)
//   DeleteTeamBand   the team shell's band: shown once Members says the viewer manages this real team, else nothing
import { useId, useState, type FormEvent } from 'react';
import { Trash2, Unplug } from 'lucide-react';
import { Alert, Button, ButtonGroup, Card, CardBody, Dialog, DialogClose, DialogContent, Input, Link } from '@bridge-ds/react';
import { confirmMatches, DELETE_TEAM_WORDS as W, deleteKindOf, githubAppsHref } from '../../../lib/delete-team';
import { useTeamPeople } from './members-state';

/** Where the page goes once the team is gone (tests swap it). */
export const leave = { to: (href: string) => location.assign(href) };

export interface DeleteTeamRowProps {
  /** owner/repo, or the key `_team/<id>` of a team made in Bridge. */
  team: string;
  /** The team's name as people call it: what the confirm field asks for. */
  name: string;
}

export function DeleteTeamRow({ team, name }: DeleteTeamRowProps) {
  const kind = deleteKindOf(team);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const ok = confirmMatches(typed, name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { deleteTeam } = await import('../../../scripts/entry-session');
      const { next } = await deleteTeam(team);
      leave.to(next);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : W.failed);
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardBody>
        <div className="set-rows">
          <div className="set-row">
            <p className="set-row-label">{W.label[kind]}</p>
            <div className="set-row-value">
              <p className="set-row-help">{W.help[kind]}</p>
            </div>
            <div className="set-row-action">
              <Button variant="secondary" iconStart={kind === 'team' ? Trash2 : Unplug} onClick={() => setOpen(true)}>
                {W.button[kind]}
              </Button>
            </div>
          </div>
        </div>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (busy) return;
            setOpen(next);
            if (!next) {
              setTyped('');
              setError(null);
            }
          }}
        >
          <DialogContent
            title={W.title[kind](name)}
            description={W.text[kind]}
            size="sm"
            hideClose
            footer={
              <ButtonGroup align="end">
                <DialogClose render={<Button variant="secondary" disabled={busy} />}>{W.cancel}</DialogClose>
                <Button type="submit" form={formId} variant="danger" loading={busy} disabled={!ok || busy}>
                  {W.button[kind]}
                </Button>
              </ButtonGroup>
            }
          >
            <form id={formId} className="set-delete-form" noValidate onSubmit={(e) => void submit(e)}>
              {kind === 'repository' && (
                <p className="set-row-help">
                  {W.github}{' '}
                  <Link href={githubAppsHref(team)} target="_blank" rel="noopener noreferrer">
                    {W.githubLink}
                  </Link>
                </p>
              )}
              <Input label={W.confirmLabel(name)} name="confirm" autoComplete="off" spellCheck={false} value={typed} onValueChange={setTyped} />
              {error && <Alert tone="danger">{error}</Alert>}
            </form>
          </DialogContent>
        </Dialog>
      </CardBody>
    </Card>
  );
}

/** The team shell's Danger zone: only for an admin of a real team (never the sample team or a visitor). */
export default function DeleteTeamBand({ layout = 'shell' }: { layout?: 'shell' | 'site' }) {
  const people = useTeamPeople();
  if (!people || people.context !== 'real' || !people.canManage) return null;
  const kind = deleteKindOf(people.repo);
  if (layout === 'site')
    return (
      <section className="set-band" id="danger-zone" aria-labelledby="set-danger">
        <div className="set-band-intro">
          <h2 id="set-danger" className="set-h">
            {W.band}
          </h2>
          <p className="set-intro">{W.intro[kind]}</p>
        </div>
        <div className="set-band-body">
          <DeleteTeamRow team={people.repo} name={people.team} />
        </div>
      </section>
    );
  return (
    <section className="ts-band set-danger" id="danger-zone" aria-labelledby="ts-danger">
      <h2 id="ts-danger" className="ts-h">
        {W.band}
      </h2>
      <p className="ts-intro">{W.intro[kind]}</p>
      <DeleteTeamRow team={people.repo} name={people.team} />
    </section>
  );
}
