// Join requests and discovery, the admin side of Entry (boards E7a, E7b and E7c), on a real team of the hosted site:
//   - "Asks to join": one layout everywhere (Settings > Members and the home of a team with no design system yet), the
//     rows of the home's "waiting on you" queue (NeedRows.tsx): the person, "asks to join Acme Design", their email and
//     "joins as Can edit" (an email account cannot review or administer, so there is nothing to pick), how long they
//     wait, Decline and Approve in the row. After a decision the row goes and a toast says so, with Undo.
//   - Discovery under the Members intro (J7-08): a DS Switch, "Let people with @acme.com find this team", with one line
//     on what happens to people who already asked. A team that cannot open to its domain reads one plain sentence.
// Without a GitHub admin linked to the account, the server refuses: one calm "Connect GitHub to manage requests".
// Calls in scripts/entry-session.ts and scripts/join-handlers.ts, words in lib/entry.ts and lib/home-model.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Switch, ToastProvider } from '@bridge-ds/react';
import { NeedList, type JoinHandlers } from './NeedRows';
import { joinNeed } from '../../../lib/home-model';
import { joinHandlers } from '../../../scripts/join-handlers';
import { discoveryLine, ENTRY_WORDS as W, type Discovery, type JoinRequest } from '../../../lib/entry';

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
      // Join requests and discovery are Bridge's own: a viewer signed in with GitHub but without a Bridge account has
      // none to read (the server would answer 401 twice). The account is read once a page, so asking costs nothing.
      const account = await import('../../../scripts/account-session')
        .then(({ getAccount }) => getAccount())
        .then((x) => x.account)
        .catch(() => null);
      if (!live || !account) return;
      const a = await api();
      const read = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
        try {
          return await fn();
        } catch (err) {
          if (live && a.needsGitHubAdmin(err)) setGitHub(true);
          return null;
        }
      };
      // Each on its own: the requests paint as soon as they land, before the members and the discovery line.
      void read(() => a.listJoinRequests(repo)).then((r) => live && setRequests(r ?? []));
      void read(() => a.getDiscovery(repo)).then((d) => live && setDiscovery(d));
    })();
    return () => {
      live = false;
    };
  }, [repo, on]);
  return { requests, setRequests, discovery, setDiscovery, github };
}

/**
 * "Asks to join": the requests, above the members or on a team's home, as the rows of the home's "waiting on you" queue
 * (StudioHome NeedList, lib/home-model joinNeed): one layout for join requests everywhere. Decline and Approve sit in the
 * row; after a decision the row goes and a toast says so, with Undo for a short while (scripts/join-handlers.ts).
 * Nothing when nobody waits.
 */
export function JoinRequests({
  repo,
  team,
  requests,
  onApproved,
  onDone,
  onUndone,
}: {
  repo: string;
  /** The team's name, for "asks to join Acme Design". */
  team?: string | undefined;
  requests: JoinRequest[];
  onApproved?: (r: JoinRequest) => void;
  onDone?: (r: JoinRequest, approved: boolean) => void;
  /** A decision taken back with Undo: the request waits again. */
  onUndone?: (r: JoinRequest) => void;
}) {
  const [now] = useState(() => Date.now());
  // Rows decided here leave at once; Undo brings them back. The parent hears the decision (onDone) and Undo (onUndone).
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const byKey = useMemo(() => new Map(requests.map((r) => [joinNeed(r, '', now).key, r])), [requests, now]);
  const decided = useRef(new Map<string, boolean>());
  const join = useMemo<JoinHandlers>(() => {
    const base = joinHandlers(
      () => repo,
      (key) => {
        setGone((g) => new Set(g).add(key));
        const r = byKey.get(key);
        if (r) onDone?.(r, decided.current.get(key) ?? false);
      },
      (key) => {
        setGone((g) => {
          const n = new Set(g);
          n.delete(key);
          return n;
        });
        const r = byKey.get(key);
        if (r) onUndone?.(r);
      },
    );
    return {
      ...base,
      decide: async (row, approve) => {
        decided.current.set(row.key, approve);
        const o = await base.decide(row, approve);
        const r = byKey.get(row.key);
        if (o.ok && approve && r) onApproved?.(r);
        return o;
      },
    };
  }, [repo, byKey, onApproved, onDone, onUndone]);
  const rows = requests.map((r) => joinNeed(r, team?.trim() || 'the team', now)).filter((row) => !gone.has(row.key));
  if (!requests.length) return null;
  // The toast (and its Undo) outlives the last row: the provider stays while there were requests.
  return (
    <ToastProvider limit={2}>
      {rows.length > 0 && (
        <section className="mem-asks" aria-labelledby="set-asks">
          <h2 id="set-asks" className="mem-title">
            {W.requestsTitle} <span className="mem-count">{rows.length}</span>
          </h2>
          <NeedList rows={rows} label={W.requestsTitle} action="secondary" compact join={join} />
        </section>
      )}
    </ToastProvider>
  );
}

/** Who can find the team: a Switch with what happens to people who already asked, or one sentence when it cannot open. */
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
  // Closed and it cannot open (the domain is no longer the admin's work domain): said, no control to try.
  if (!line.on && !line.canTurnOn) return <p className="mem-intro mem-discovery">{W.discoveryOff(line.domain)}</p>;
  if (needsGitHub)
    return (
      <p className="mem-intro">
        <GitHubLink />
      </p>
    );
  return (
    <div className="mem-discovery">
      <Switch
        label={W.findable(line.domain)}
        description={line.on ? W.discoveryOnHelp : W.discoveryOffHelp}
        checked={line.on}
        disabled={busy}
        onCheckedChange={(on) => void toggle(on)}
      />
      {problem && (
        <p className="mem-intro" role="status">
          {problem}
        </p>
      )}
    </div>
  );
}
