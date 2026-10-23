// Settings on a team shell (pages/team-shell/settings): the team's own rules, read from its repository model in the
// browser (scripts/team-data.ts, the same read every team page shares; a signed-out visitor's reads are answered from
// the team's published activity, no GitHub API call). Read only, in the bands of the self-hosted Settings:
//   How changes reach your code  suggestions or pull requests (bridge.config.json `changes`)
//   Review rules                 design and tech owners, who approves and merges, what each kind of branch needs
//                                (governance in bridge.config.json, the rules from docs/GOVERNANCE.md)
//   Safety                       when the visual before and after runs
// On the sample team (Acme Design) this is the full Settings with its persona, never the repository's accounts; on any
// other team, Bridge's own design system included, it is that team's own setup.
// Repo strings reach the page as React text only.
import { Users } from 'lucide-react';
import { Avatar, Card, CardBody, CardHeader, Tag } from '@bridge-ds/react';
import { parseOwnerEntry } from '@bridge-ds/core';
import ChangeRules from './ChangeRules';
import { TeamLoadError, TeamLoadProgress, useTeamData } from './TeamState';
import { OWNER_GROUP_HELP, OWNER_GROUP_LABEL, roleRows, VISUAL_MODE_HELP, VISUAL_MODE_LABEL } from '../../../lib/roles-view';
import { CHANGES_CHOICE, overrideRow, soloOwnerRow } from '../../../lib/settings-view';
import { demoSettingsPeople, isSampleTeam } from '../../../lib/demo';

export interface TeamSettingsProps {
  /** What each kind of branch needs, in plain words (lib/settings-view approvalRules, from docs/GOVERNANCE.md). */
  rules: { what: string; who: string }[];
}

const avatarSrc = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=48`;

function Owners({ entries, demoLead }: { entries: string[]; demoLead: string | null }) {
  // The demo names its persona (initials, as on the demo home), never the repository's real accounts.
  if (demoLead)
    return (
      <span className="set-owner-list">
        <span className="set-owner">
          <Avatar name={demoLead} size="xs" decorative />
          <span>{demoLead}</span>
        </span>
      </span>
    );
  if (!entries.length) return <span className="set-quiet">Nobody listed yet</span>;
  return (
    <span className="set-owner-list">
      {entries.map((raw) => {
        const e = parseOwnerEntry(raw);
        if (!e) return null;
        return e.kind === 'person' ? (
          <span className="set-owner" key={raw}>
            <Avatar name={e.login} src={avatarSrc(e.login)} size="xs" decorative />
            <span>@{e.login}</span>
          </span>
        ) : (
          <span className="set-owner" key={raw}>
            <Tag icon={Users} size="sm">{`@${e.org}/${e.slug}`}</Tag>
          </span>
        );
      })}
    </span>
  );
}

function Band({ id, title, intro, children }: { id: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="ts-band" id={id} aria-labelledby={`ts-${id}`}>
      <h2 id={`ts-${id}`} className="ts-h">
        {title}
      </h2>
      <p className="ts-intro">{intro}</p>
      {children}
    </section>
  );
}

export default function TeamSettings({ rules }: TeamSettingsProps) {
  const { load, retry } = useTeamData();
  if (load.status === 'loading') return <TeamLoadProgress label="Reading the settings of this design system" />;
  if (load.status === 'error') return <TeamLoadError failure={load.failure} onRetry={retry} />;
  const site = load.data.model.site;
  // The sample team (Acme Design) tells its persona (lib/demo.ts demoSettingsPeople); every real team, Bridge's own
  // design system included, reads its own config.
  const demo = isSampleTeam(`${load.data.owner}/${load.data.repo}`) ? demoSettingsPeople(site) : null;
  const changes = CHANGES_CHOICE[site.changes];
  const roles = roleRows(site.owners, site.rights);
  const realSolo = soloOwnerRow(site);
  const solo = demo ? (realSolo && demo.solo ? { ...realSolo, value: demo.solo } : null) : realSolo;
  // Who may use the owner override: owners only, the same list the Home and the branch page read (the persona on the demo).
  const override = overrideRow(site, demo?.nameOf);
  const mode = site.visualImpact.mode;
  return (
    <>
      <Band id="changes" title="How changes reach your code" intro="When the team keeps a change, Bridge hands it to the developers as a suggestion, or opens a pull request itself.">
        <Card>
          <CardBody>
            <div className="set-rows">
              <div className="set-row">
                <p className="set-row-label">{changes.title}</p>
                <p className="set-row-value set-row-span">{changes.lead ? `${changes.lead} ${changes.text}` : changes.text}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </Band>

      <Band id="roles" title="Review rules" intro="Who approves a branch before it is merged into main, and what each kind of branch needs.">
        <Card aria-labelledby="ts-roles-title">
          <CardHeader>
            <h3 id="ts-roles-title" className="set-card-title">
              Who approves and merges
            </h3>
          </CardHeader>
          <CardBody>
            <div className="set-rows">
              {(['design', 'tech'] as const).map((g) => (
                <div className="set-row" key={g}>
                  <div>
                    <p className="set-row-label">{OWNER_GROUP_LABEL[g]}</p>
                    <p className="set-row-help">{OWNER_GROUP_HELP[g]}</p>
                  </div>
                  <div className="set-row-value set-row-span">
                    <Owners entries={site.owners[g]} demoLead={demo?.lead ?? null} />
                  </div>
                </div>
              ))}
              {roles.map((x) => (
                <div className="set-row" key={x.right}>
                  <div>
                    <p className="set-row-label">{x.label}</p>
                    <p className="set-row-help">{x.help}</p>
                  </div>
                  <p className="set-row-value set-row-span set-who">{x.who}</p>
                </div>
              ))}
              {solo && (
                <div className="set-row">
                  <div>
                    <p className="set-row-label">{solo.label}</p>
                    <p className="set-row-help">{solo.help}</p>
                  </div>
                  <p className="set-row-value set-row-span set-who">{solo.value}</p>
                </div>
              )}
              {override && (
                <div className="set-row">
                  <div>
                    <p className="set-row-label">{override.label}</p>
                    <p className="set-row-help">{override.help}</p>
                  </div>
                  <p className="set-row-value set-row-span set-who">{override.value}</p>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
        <ChangeRules rules={rules} />
      </Band>

      <Band id="safety" title="Safety" intro="When the visual before and after runs on a branch.">
        <Card>
          <CardBody>
            <div className="set-rows">
              <div className="set-row">
                <p className="set-row-label">Visual before and after</p>
                <div className="set-row-value set-row-span">
                  <p className="set-who">{VISUAL_MODE_LABEL[mode]}</p>
                  <p className="set-row-help">{VISUAL_MODE_HELP[mode]}</p>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </Band>
    </>
  );
}
