// Library > Use > How review works, for any design system: risk tiers at rest, then collapsible sections (the journey
// of a change, component change requests, suggestions, explorations, review gates, owner override, approvals by
// area, the AI agent's rules, what reviewers check on an agent's pull request). Bridge's own page reads them from its
// docs/GOVERNANCE.md and AGENTS.md at build time; a team's Library reads the team's own governance files when it has
// them, else its bridge.config.json governance (owners, rights, guardrails, override) and the tiers Bridge computes.
import { Link } from '@bridge-ds/react';
import MarkdownTable from '../../MarkdownTable';
import InlineMd from '../../InlineMd';
import { inline } from '../../../../lib/markdown';
import { configApprovals, configGates, type RuleHeading } from '../../../../lib/library/use-pages';
import { LibraryHeader } from '../FoundationParts';
import { studioLink, type LibraryData } from '../library-data';

export const REVIEW_PAGE = { title: 'How review works', art: 'guide', studio: 'settings/#approvals' } as const;

const JOURNEY: { title: string; text: string }[] = [
  { title: 'Explore in Figma', text: 'A designer tries the change on real screens. Nothing in Figma reaches the product by itself.' },
  {
    title: 'Create a branch and request review',
    text: 'In Studio or the DS Bridge Figma plugin, a designer creates a branch off main and requests a review, the way Figma branching works. On GitHub that branch is a pull request against the token files. An issue works too; then the AI agent or a maintainer writes the pull request.',
  },
  {
    title: 'Pull request',
    text: 'The branch is a diff with a risk tier, a changelog entry and a note on what to review. Studio shows it as a branch with its status: Draft, In review, Approved, waiting for code, Merged or Closed.',
  },
  { title: 'CI guardrails', text: 'Checks run on every pull request: tokens build, types check, no raw colors or shadows in components, Storybook builds, a changelog entry exists.' },
  { title: 'Design and tech review', text: 'The design owner checks both themes, contrast and keyboard focus. The tech owner checks naming, API and version bump. Token changes need both.' },
  { title: 'Review and merge', text: 'A person who owns that area merges the branch into main. The AI agent never merges.' },
  { title: 'Publish', text: 'Changesets bumps the version and writes the changelog from the entries collected in each pull request.' },
  {
    title: 'Docs update themselves',
    text: 'This site rebuilds from the repo: color tables, contrast checks, component pages, the changelog and llms.txt. Figma variables are re-imported from the same files.',
  },
];

const RULE_INTRO: Record<RuleHeading, string> = {
  Always: 'On every change.',
  'Ask before': 'It stops and asks a person first, and the pull request gets the higher tier.',
  Never: 'Hard limits. Most are also blocked by CI.',
};

const REQUEST_STEPS: { title: string; text: string }[] = [
  {
    title: 'Request',
    text: 'A designer asks for a new component or a change (variant, prop, structure, visual, token binding) from the Push tab of the Figma plugin or from a component in Studio. It becomes a GitHub issue labeled component-change.',
  },
  { title: 'Implement', text: 'A developer, or Claude with `bridge request implement <number>` or the `bridge_get_request` MCP tool, changes the code in a pull request that says `Closes #<number>`.' },
  { title: 'Review and merge', text: 'The pull request goes through the same tiers and gates as any other change. When it merges, the request closes as done.' },
];
const SUGGESTION_STEPS: { title: string; text: string }[] = [
  {
    title: 'Suggest',
    text: 'When the team works in suggestion mode, a designer sends the change from Studio, the Figma plugin or Claude. It becomes a GitHub issue labeled `bridge-suggestion`: what changes, its checks, and a machine-readable block a developer applies. Nobody needs write access to the code.',
  },
  {
    title: 'Review',
    text: 'Owners decide in Studio (Branches and the review queue) or on GitHub: Approve, Suggest changes or Decline. Only owners listed in `bridge.config.json` count, and an approval counts for the version they saw: when the suggestion changes, earlier approvals stop counting and Studio says so.',
  },
  {
    title: 'Apply',
    text: 'A developer runs `npx bridge apply <number>` or asks Claude to "Apply Bridge suggestion #<number>". Bridge checks it again against main as it is now and stops on a conflict. The pull request says `Closes #<number>` and goes through the same tiers and gates.',
  },
];
const EXPLORE_STEPS: { title: string; text: string }[] = [
  {
    title: 'Start',
    text: 'From Studio Branches, Explorations, `bridge explore start <name>` or Claude (`bridge_start_exploration`): a branch `explore/<name>` from main and a draft pull request labeled `exploration`. Token edits and requests filed on it land there, never on main.',
  },
  {
    title: 'Try it in a product staging branch',
    text: 'Every push publishes snapshot packages (`npm i @bridge-ds/react@<snapshot>`) and per-branch previews: a coded prototype for a user test, a stakeholder demo or an A/B idea on real screens.',
  },
  {
    title: 'Promote or close',
    text: 'It is never merged as is: the `Exploration not merged as is` check fails while the label is on. Promote to review removes the label, adds the tier labels and marks it ready, then the usual gates apply. Otherwise, close it.',
  },
];

function Steps({ steps, md = true }: { steps: { title: string; text: string }[]; md?: boolean }) {
  return (
    <ol className="rw-steps">
      {steps.map((s) => (
        <li key={s.title}>
          <p className="rw-step-title">{s.title}</p>
          <p>{md ? <InlineMd md={s.text} /> : s.text}</p>
        </li>
      ))}
    </ol>
  );
}

function Section({ id, title, n, children }: { id: string; title: string; n: string | number; children: React.ReactNode }) {
  return (
    <details className="rw-sec" id={id}>
      <summary>
        <h2>{title}</h2>
        <span className="rw-n">{n}</span>
      </summary>
      {children}
    </details>
  );
}

export default function ReviewView({ data }: { data: LibraryData }) {
  const use = data.extras.use;
  const gov = use?.governance ?? {};
  const tiers = gov.tiers ?? use?.bridge.tiers ?? null;
  const tierRows = tiers ? tiers.rows.map((row) => [`Tier ${inline(row[0] ?? '')}`, ...row.slice(1).map(inline)]) : [];
  const tierIds = tiers ? tiers.rows.map((row) => `tier-${(row[0] ?? '').split(',')[0]!.trim()}`) : [];
  const who = gov.approvals ?? (data.team ? configApprovals(data.model) : null);
  const whoRows = who ? who.rows.map((row) => row.map(inline)) : [];
  const gates = gov.gates?.length ? gov.gates : data.team ? configGates(data.model) : [];
  const agentChecks = gov.agentPrs?.length ? gov.agentPrs : (use?.bridge.agentPrs ?? []);
  const rules = gov.rules ?? [];
  const ruleCount = rules.reduce((n, g) => n + g.rules.length, 0);
  const override = data.model.site?.override;
  const allowed = (override?.allowed ?? []).map((l) => `@${l}`).join(', ');
  return (
    <div>
      <LibraryHeader title={REVIEW_PAGE.title} art={REVIEW_PAGE.art} studio={studioLink(data, REVIEW_PAGE.studio)} studioLabel="Open in Studio" canEdit={data.extras.canEdit}>
        Every change goes through the same gates, whoever writes it: a designer, an engineer or an AI agent. The riskier the change, the more review it gets.
      </LibraryHeader>

      <h2 id="tiers">Risk tiers</h2>
      <p>
        The tier decides who approves. If a change spans tiers, the highest one applies, and Bridge computes it the same way in the plugin, the Studio, the CLI and the MCP server.
      </p>
      {tiers && <MarkdownTable className="rw-table" label="Risk tiers" head={tiers.head} rows={tierRows} rowIds={tierIds} />}

      <div className="rw-secs">
        <Section id="journey" title="How a change travels" n={`${JOURNEY.length} steps`}>
          <Steps steps={JOURNEY} md={false} />
        </Section>

        <Section id="requests" title="Component change requests" n={`${REQUEST_STEPS.length} steps`}>
          <p>
            Variables are data: a variable edit is a pull request you approve. Components are code: a component change is a request, and a pull request that closes it does the work. Teams
            triage requests where they plan: in GitHub by the <code>component-change</code> label, or in Jira when Settings connects it.
          </p>
          <Steps steps={REQUEST_STEPS} />
        </Section>

        <Section id="suggestions" title="Suggestions" n={`${SUGGESTION_STEPS.length} steps`}>
          <p>
            A suggestion is a change filed as an issue instead of a branch, for teams where designers do not write to the code. The tier decides who approves it, as for a branch. Follow them in
            GitHub by the <code>bridge-suggestion</code> label; Studio lists the ones that wait on you on Home and in the review queue.
          </p>
          <Steps steps={SUGGESTION_STEPS} />
        </Section>

        <Section id="explorations" title="Explorations" n={`${EXPLORE_STEPS.length} steps`}>
          <p>
            An exploration tries experimental variables and components in a real product staging branch without touching main. Follow them in{' '}
            <Link href={studioLink(data, 'changes/?view=explorations')}>Studio Branches, Explorations</Link>, or in GitHub by the <code>exploration</code> label.
          </p>
          <Steps steps={EXPLORE_STEPS} />
        </Section>

        {gates.length > 0 && (
          <Section id="gates" title="Review gates" n={gates.length}>
            <ol className="rw-list">
              {gates.map((g, i) => (
                <li key={i}>
                  <InlineMd md={g} />
                </li>
              ))}
            </ol>
          </Section>
        )}

        <Section id="owner-override" title="Owner override" n={allowed ? 'on' : 'off'}>
          <p>
            GitHub never lets authors approve their own pull request, so a solo maintainer can never collect a design and a tech approval. The owner override is the audited way through, and it
            is off unless <code>bridge.config.json</code> turns it on.
          </p>
          <ul className="rw-list">
            <li>
              <strong>Who.</strong> {allowed ? `${allowed}, with a token that has write access.` : 'Nobody in this repository.'} Agents never use it.
            </li>
            <li>
              <strong>When.</strong> Only when approvals are the one thing missing: never while CI fails or runs, after a request for changes, on a draft, or with a merge conflict.
            </li>
            <li>
              <strong>Trail.</strong> Bridge posts the reason on the pull request{override?.requireReason ? ` (${override.minReasonLength} characters or more)` : ''} before it merges, and History
              shows it.
            </li>
            <li>
              <strong>Branch protection still wins.</strong> The override changes what Bridge allows, not what GitHub enforces.
            </li>
          </ul>
        </Section>

        {who && (
          <Section id="by-area" title="Who approves by area" n={who.rows.length}>
            <MarkdownTable className="rw-table" label="Who approves by area" head={who.head} rows={whoRows} />
          </Section>
        )}

        {rules.length > 0 && (
          <Section id="agent" title="Rules the AI agent follows" n={ruleCount}>
            <p>
              The agent reads <code>AGENTS.md</code> before every task. Its rules in plain language; open a rule for its exact wording.
            </p>
            {rules.map((group) => {
              const gid = `rw-${group.heading.replace(' ', '-').toLowerCase()}`;
              return (
                <section key={group.heading} className="rw-rules" aria-labelledby={gid}>
                  <h3 id={gid}>
                    {group.heading} <span className="rw-n">{group.rules.length}</span>
                  </h3>
                  <p className="rw-muted">{RULE_INTRO[group.heading]}</p>
                  <ul className="rw-list rw-rule-list">
                    {group.rules.map((rule, i) =>
                      rule.rewritten ? (
                        <li key={i}>
                          <details className="rw-rule">
                            <summary>{rule.plain}</summary>
                            <p className="rw-muted">
                              <InlineMd md={rule.original} />
                            </p>
                          </details>
                        </li>
                      ) : (
                        <li key={i}>
                          <InlineMd md={rule.original} />
                        </li>
                      ),
                    )}
                  </ul>
                </section>
              );
            })}
          </Section>
        )}

        {agentChecks.length > 0 && (
          <Section id="agent-prs" title="Reviewing an agent's pull request" n={agentChecks.length}>
            <ul className="rw-list">
              {agentChecks.map((c, i) => (
                <li key={i}>
                  <InlineMd md={c} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
