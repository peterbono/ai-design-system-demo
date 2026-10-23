// Settings > Members, admin side of Entry (boards E7a and E7c), on a real team of the hosted site only:
//   - "Asks to join": each person who found the team with the work domain, their email, "Found the team with
//     @acme.com · asked 1 h ago", the role they get (Can edit, preset: an email account cannot review or administer),
//     Decline and Approve on the same row. After a decision the row says so, then leaves.
//   - The discovery line under the Members intro: "People with @acme.com can find this team and ask to join." with
//     Turn off, or the same choice to turn on when the admin has a work email and the team never chose.
// Without a GitHub admin linked to the account, the server refuses: one calm "Connect GitHub to manage requests".
// Calls in scripts/entry-session.ts, words in lib/entry.ts.
import { useEffect, useState } from 'react';
import { Button, ButtonGroup } from '@bridge-ds/react';
import RolePicker from './RolePicker';
import { PersonCell } from './MemberParts';
import { askedAgo, discoveryLine, emailDomain, ENTRY_WORDS as W, type Discovery, type JoinRequest } from '../../../lib/entry';
import { DEFAULT_CHOICE } from '../../../lib/invites';

async function api() {
  return import('../../../scripts/entry-session');
}

function connectGitHub() {
  void import('../../../scripts/account-session').then(({ linkGitHub }) => linkGitHub(location.pathname + location.search + location.hash));
}

function GitHubLink() {
  return (
    <Button variant="link" size="sm" onClick={connectGitHub}>
      {W.githubToManage}
    </Button>
  );
}

/** The join requests and discovery of a team, read once `on` (a real team, its admin, on the hosted site). */
export function useEntryAdmin(repo: string, on: boolean) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [github, setGitHub] = useState(false);
  useEffect(() => {
    if (!on || !repo) return;
    let live = true;
    void (async () => {
      const a = await api();
      const read = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
        try {
          return await fn();
        } catch (err) {
          if (live && a.needsGitHubAdmin(err)) setGitHub(true);
          return null;
        }
      };
      const [r, d] = await Promise.all([read(() => a.listJoinRequests(repo)), read(() => a.getDiscovery(repo))]);
      if (!live) return;
      setRequests(r ?? []);
      setDiscovery(d);
    })();
    return () => {
      live = false;
    };
  }, [repo, on]);
  return { requests, setRequests, discovery, setDiscovery, github };
}

function RequestRow({ r, repo, now, onDone }: { r: JoinRequest; repo: string; now: number; onDone: (approved: boolean) => void }) {
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [github, setGitHub] = useState(false);
  const domain = emailDomain(r.email);
  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'decline');
    const a = await api();
    try {
      if (approve) await a.approveRequest(repo, r.id);
      else await a.declineRequest(repo, r.id);
      setSaid(approve ? W.joined(r.name) : W.declined(r.name));
      setTimeout(() => onDone(approve), 4000);
    } catch (err) {
      if (a.needsGitHubAdmin(err)) setGitHub(true);
      else setSaid(err instanceof Error ? err.message : null);
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="mem-ask">
      <PersonCell name={r.name} seed={r.email} line={<>{r.email}</>} />
      <span className="mem-ask-found">{W.foundWith(domain, askedAgo(r.createdAt, now))}</span>
      <span className="mem-ask-end">
        {said ? (
          <span className="mem-ask-said" role="status">
            {said}
          </span>
        ) : github ? (
          <GitHubLink />
        ) : (
          <>
            <RolePicker label={`Role for ${r.name}`} value={DEFAULT_CHOICE} emailOnly size="sm" onChange={() => undefined} />
            <ButtonGroup>
              <Button variant="secondary" size="sm" loading={busy === 'decline'} disabled={Boolean(busy)} aria-label={`${W.decline} ${r.name}`} onClick={() => void decide(false)}>
                {W.decline}
              </Button>
              <Button variant="primary" size="sm" loading={busy === 'approve'} disabled={Boolean(busy)} aria-label={`${W.approve} ${r.name}`} onClick={() => void decide(true)}>
                {W.approve}
              </Button>
            </ButtonGroup>
          </>
        )}
      </span>
    </li>
  );
}

/** "Asks to join": the requests, above the members. Nothing when nobody waits. */
export function JoinRequests({ repo, requests, onDone }: { repo: string; requests: JoinRequest[]; onDone: (r: JoinRequest, approved: boolean) => void }) {
  const [now] = useState(() => Date.now());
  if (!requests.length) return null;
  return (
    <section className="mem-asks" aria-labelledby="set-asks">
      <h2 id="set-asks" className="mem-title">
        {W.requestsTitle} <span className="mem-count">{requests.length}</span>
      </h2>
      <ul className="mem-ask-list">
        {requests.map((r) => (
          <RequestRow key={r.id} r={r} repo={repo} now={now} onDone={(approved) => onDone(r, approved)} />
        ))}
      </ul>
    </section>
  );
}

/** The one line that says who can find the team, with Turn off (or Turn on). */
export function DiscoveryLine({ repo, discovery, github, onChange }: { repo: string; discovery: Discovery | null; github: boolean; onChange: (d: Discovery) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [needsGitHub, setNeedsGitHub] = useState(false);
  const line = discoveryLine(discovery);
  if (!line)
    return github ? (
      <p className="mem-intro">
        <GitHubLink />
      </p>
    ) : null;
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setProblem(null);
    const a = await api();
    try {
      const r = await a.setDiscovery(repo, enabled);
      onChange({ ...discovery!, domain: r.domain ?? line.domain, enabled: r.enabled, configured: true });
    } catch (err) {
      if (a.needsGitHubAdmin(err)) setNeedsGitHub(true);
      else setProblem(err instanceof Error ? err.message : null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <p className="mem-intro mem-discovery">
      {line.on ? (
        <span>
          {W.discoveryOn[0]} <b className="mem-strong">@{line.domain}</b> {W.discoveryOn[1]}
        </span>
      ) : (
        <span>{line.canTurnOn ? W.findable(line.domain) + '.' : W.discoveryOff(line.domain)}</span>
      )}{' '}
      {needsGitHub ? (
        <GitHubLink />
      ) : (
        (line.on || line.canTurnOn) && (
          <Button variant="link" size="sm" loading={busy} onClick={() => void toggle(!line.on)}>
            {line.on ? W.turnOff : W.turnOn}
          </Button>
        )
      )}
      {problem && (
        <span className="mem-line" role="status">
          {' '}
          {problem}
        </span>
      )}
    </p>
  );
}
