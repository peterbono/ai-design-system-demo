// Settings > Review rules > Design owners / Tech owners: who is in each owner group, people or GitHub teams.
// View: a person is an avatar and their name (lib/people ownerName: the team member's Bridge name, the profile name, or
// the login without the @); a team is a team chip with its member count and an avatar stack, read
// from GitHub with the viewer's token (scripts/teams.ts). A team that cannot be read gets one plain sentence with
// the reason and the fix. Edit (the form's Edit button): a DS Combobox that takes people and teams, suggesting the
// organization's teams and the repository's people when GitHub lists them, and anything typed as @login or
// @org/team. The value goes to the form through a hidden [data-owners-control] element and a "bridge:owners" event;
// scripts/roles.ts sends it for review with the rest of the form. Cancel resets it ("bridge:owners-reset").
import { useEffect, useMemo, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { Avatar, AvatarGroup, Combobox, Tag } from '@bridge-ds/react';
import { parseOwnerEntry, teamKey, type OwnerGroup, type TeamStates, type TeamUnreadableReason } from '@bridge-ds/core';
import { OWNER_GROUP_LABEL, ownerFromInput, ownerOptions, teamsPickerHint } from '../../../lib/roles-view';
import { hasWorkingToken, prefersSignIn, readRepo, studioClient } from '../../../scripts/github-session';
import { loadTeams, teamDirectory } from '../../../scripts/teams';
import { ownerName } from '../../../lib/people';
import { knownNames } from '../../../scripts/people';
import { useTeamPeople } from './members-state';

export interface OwnersFieldProps {
  group: OwnerGroup;
  /** The repository owner: an organization has teams, a personal account does not. */
  org: string;
  /** The entries in bridge.config.json on the default branch. */
  initial: string[];
}

const avatarSrc = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=48`;
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export default function OwnersField({ group, initial, org }: OwnersFieldProps) {
  const [teams, setTeams] = useState<TeamStates | null>(null);
  const [value, setValue] = useState<string[]>(initial);
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState<{ teams: { slug: string; name: string }[]; people: string[]; reason: TeamUnreadableReason | null } | null>(null);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const control = useRef<HTMLSpanElement>(null);
  const members = useTeamPeople()?.members ?? [];

  // Team members for the view, again when the viewer connects.
  useEffect(() => {
    const read = () => void loadTeams().then(setTeams);
    read();
    const onAuth = () => {
      setPicker(null);
      read();
    };
    const onReset = () => {
      setValue(initial);
      setQuery('');
    };
    document.addEventListener('bridge:auth', onAuth);
    document.addEventListener('bridge:owners-reset', onReset);
    return () => {
      document.removeEventListener('bridge:auth', onAuth);
      document.removeEventListener('bridge:owners-reset', onReset);
    };
  }, [initial]);

  // The form reads the value from the hidden control and repaints on the event.
  useEffect(() => {
    const el = control.current;
    if (!el) return;
    el.dataset.value = JSON.stringify(value);
    el.dispatchEvent(new CustomEvent('bridge:owners', { bubbles: true, detail: { group, value } }));
  }, [group, value]);

  /** Suggestions, read once when the picker first opens: the org's teams and the people with write access. */
  const loadPicker = () => {
    if (picker || loadingPicker) return;
    setLoadingPicker(true);
    const r = readRepo();
    const gh = studioClient(`${r.owner}/${r.repo}`);
    void Promise.all([
      teamDirectory().orgTeams(org),
      hasWorkingToken() ? gh.listCollaborators('push').then((xs) => xs.map((x) => x.login), () => [] as string[]) : Promise.resolve([] as string[]),
    ])
      .then(([t, p]) => setPicker({ teams: t.status === 'ok' ? t.teams : [], people: p, reason: t.status === 'ok' ? null : t.reason }))
      .finally(() => setLoadingPicker(false));
  };

  const options = useMemo(() => {
    const opts = ownerOptions({ teams: picker?.teams, people: picker?.people, org, query });
    // Entries already chosen keep a label in the chips even when no suggestion lists them.
    for (const v of value) if (!opts.some((o) => o.value === v)) opts.push({ value: v, label: parseOwnerEntry(v)?.kind === 'team' ? v : `@${v.replace(/^@/, '')}` });
    return opts;
  }, [picker, org, query, value]);

  const typed = ownerFromInput(query);
  const error = typed && 'error' in typed ? typed.error : undefined;
  const hint = picker ? teamsPickerHint(picker.reason, org, prefersSignIn()) : undefined;

  const unreadable = initial
    .map((raw) => parseOwnerEntry(raw))
    .flatMap((e) => (e?.kind === 'team' ? [teams?.[teamKey(e.org, e.slug)]] : []))
    .filter((s): s is Extract<NonNullable<TeamStates[string]>, { status: 'unreadable' }> => s?.status === 'unreadable');

  return (
    <div className="set-owners">
      <span hidden ref={control} data-owners-control data-group={group} data-initial={JSON.stringify(initial)} data-value={JSON.stringify(value)} />
      <div className="set-owner-list" data-view>
        {initial.length === 0 && <span className="set-quiet">Nobody listed yet</span>}
        {initial.map((raw) => {
          const e = parseOwnerEntry(raw);
          if (!e) return null;
          if (e.kind === 'person') {
            const who = ownerName(e.login, members, knownNames());
            return (
              <span className="set-owner" key={raw}>
                <Avatar name={who} src={avatarSrc(e.login)} size="xs" decorative />
                <span>{who}</span>
              </span>
            );
          }
          const name = `@${e.org}/${e.slug}`;
          const state = teams?.[teamKey(e.org, e.slug)];
          return (
            <span className="set-owner" key={raw}>
              <Tag icon={Users} size="sm">
                {name}
              </Tag>
              {state?.status === 'ok' && (
                <>
                  <span className="set-quiet">{people(state.members.length)}</span>
                  {state.members.length > 0 && (
                    <AvatarGroup aria-label={`Members of ${name}`} max={4} size="xs">
                      {state.members.map((m) => (
                        <Avatar key={m} name={m} src={avatarSrc(m)} size="xs" />
                      ))}
                    </AvatarGroup>
                  )}
                </>
              )}
            </span>
          );
        })}
      </div>
      {unreadable.map((t) => (
        <p className="set-row-help" data-view key={t.key}>
          {t.message}
        </p>
      ))}
      <div data-edit>
        <Combobox
          label={OWNER_GROUP_LABEL[group]}
          hideLabel
          multiple
          options={options}
          value={value}
          onValueChange={(v) => {
            setValue(Array.isArray(v) ? v : v ? [v] : []);
            setQuery('');
          }}
          inputValue={query}
          onInputValueChange={setQuery}
          onOpenChange={(open) => open && loadPicker()}
          onFocus={loadPicker}
          loading={loadingPicker}
          loadingMessage="Loading teams and people"
          placeholder="Add @login or @org/team"
          emptyMessage={error ?? 'Type @login for a person or @org/team for a team.'}
          hint={hint ?? undefined}
        />
      </div>
    </div>
  );
}
