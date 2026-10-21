// "Invite your team" (multi-team plan 7.2): the team link in a read-only field with Copy link as the largest target,
// then "Who can do what" collapsed (GitHub access mapped to what each person can do in Bridge), and for admins only
// "Manage access on GitHub". One component in two places: onboarding step "Invite your team" (Onboarding.tsx) and
// Settings > Your team (TeamLinkLive, which reads the session itself). Words and rules: lib/access-view.ts.
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Accordion, AccordionItem, Badge, Button, Input, Link } from '@bridge-ds/react';
import type { ChangesMode, RepoAccessState } from '@bridge-ds/core';
import { accessBadge, accessSummary, manageAccessUrl, NO_ACCESS_LINE, orgTeamsUrl, teamLink, viewerRow, whoCanDoWhat } from '../../../lib/access-view';
import { STUDIO_ROOT, studioBase } from '../../../lib/team-path';

/** Copies text, then says so for 2 s. `said` is the line for a screen reader (or how to copy by hand). */
export function useCopy(ms = 2000) {
  const [copied, setCopied] = useState(false);
  const [said, setSaid] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string, done: string): Promise<boolean> => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setSaid(done);
      timer.current = setTimeout(() => setCopied(false), ms);
      return true;
    } catch {
      setCopied(false);
      setSaid('Copy is not available in this browser. Select the text and copy it with your keyboard.');
      return false;
    }
  };
  return { copied, said, copy };
}

export interface TeamLinkProps {
  owner: string;
  repo: string;
  /** The link to share (lib/access-view.ts teamLink). */
  link: string;
  /** The viewer's access, null while unknown or signed out. */
  access: RepoAccessState | null;
  changes?: ChangesMode | null;
  owners?: { design?: string[]; tech?: string[] };
  /** The owner is an organization: offer its Teams page next to Manage access. */
  org?: boolean;
  /** Called once the link is on the clipboard (onboarding marks the step done). */
  onCopied?: () => void;
  /** The id prefix of the field and the fold, unique on the page. */
  id?: string;
}

export function TeamLink({ owner, repo, link, access, changes, owners, org, onCopied, id = 'team-link' }: TeamLinkProps) {
  const { copied, said, copy } = useCopy();
  const rows = whoCanDoWhat({ changes, owners });
  const mine = viewerRow(access);
  const admin = access === 'admin';
  return (
    <div className="tlk">
      <div className="tlk-field">
        <Input label="Team link" hideLabel id={`${id}-field`} value={link} readOnly className="tlk-input mono" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="primary"
          iconStart={copied ? Check : Copy}
          className="tlk-copy"
          onClick={async () => {
            if (await copy(link, 'Link copied')) onCopied?.();
          }}
        >
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      {said && !copied && <p className="tlk-quiet">{said}</p>}
      <Accordion appearance="flush" headingLevel={3} className="tlk-fold">
        <AccordionItem value="who" title="Who can do what">
          <ul className="tlk-rows" aria-label="Who can do what">
            {rows.map((r) => (
              <li key={r.id} className="tlk-row" data-mine={r.id === mine ? '' : undefined}>
                <span className="tlk-who">
                  {r.who}
                  {r.id === mine && (
                    <Badge size="sm" tone="info">
                      You
                    </Badge>
                  )}
                </span>
                <span className="tlk-can">{r.can}</span>
              </li>
            ))}
          </ul>
          <p className="tlk-quiet">{NO_ACCESS_LINE}</p>
        </AccordionItem>
      </Accordion>
      {admin && (
        <p className="tlk-admin">
          <Link href={manageAccessUrl(owner, repo)} external>
            Manage access on GitHub
          </Link>
          {org && (
            <Link href={orgTeamsUrl(owner)} external>
              Teams
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

export interface TeamLinkLiveProps {
  /** Build-time fallbacks (self-hosted Settings); a team's Bridge reads them from the address and its settings. */
  owner?: string;
  repo?: string;
  changes?: ChangesMode | null;
  owners?: { design?: string[]; tech?: string[] };
}

/**
 * Settings > Your team: one summary sentence (what the viewer can do here, with the access badge), then TeamLink.
 * Reads the shared GitHub session and the page's repository in the browser.
 */
export function TeamLinkLive(props: TeamLinkLiveProps) {
  const [ctx, setCtx] = useState<{ owner: string; repo: string; link: string; changes: ChangesMode | null; owners?: TeamLinkProps['owners'] } | null>(null);
  const [access, setAccess] = useState<RepoAccessState | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [org, setOrg] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ repoContext, siteConfig }, session] = await Promise.all([import('../../../scripts/repo-context'), import('../../../scripts/github-session')]);
      if (!live) return;
      const read = () => {
        const r = repoContext();
        const cfg = siteConfig();
        const base = r.hosted ? studioBase(location.pathname, true) : STUDIO_ROOT;
        setCtx({
          owner: r.owner,
          repo: r.repo,
          link: teamLink(location.origin, base),
          changes: (cfg.changes as ChangesMode | undefined) ?? props.changes ?? null,
          owners: cfg.owners ?? props.owners,
        });
      };
      read();
      session.initGitHubConnect((v) => {
        setLogin(v?.login ?? null);
        if (!v) setAccess(null);
        read();
      });
      session.onAccess((a) => {
        setAccess(a?.state ?? null);
        read();
      });
      document.addEventListener('bridge:team-model', read);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ctx) return;
    // An organization has a Teams page; GitHub says the account type on the public user endpoint, cached by ghGet.
    void import('../../../scripts/github-session').then(({ ghGet }) =>
      ghGet<{ type?: string }>(`/users/${encodeURIComponent(ctx.owner)}`)
        .then((r) => setOrg(r.data?.type === 'Organization'))
        .catch(() => setOrg(false)),
    );
  }, [ctx?.owner]);

  const owner = ctx?.owner ?? props.owner ?? '';
  const repo = ctx?.repo ?? props.repo ?? '';
  const name = `${owner}/${repo}`;
  const badge = accessBadge(access, Boolean(login));
  return (
    <div className="tlk-live">
      <p className="tlk-summary">
        <Badge size="sm" tone={badge.tone} dot>
          {badge.label}
        </Badge>
        <span>{accessSummary(login ? access : null, { login, repo: name })}</span>
      </p>
      <TeamLink
        id="set-team-link"
        owner={owner}
        repo={repo}
        link={ctx?.link ?? STUDIO_ROOT}
        access={login ? access : null}
        changes={ctx?.changes ?? props.changes ?? null}
        owners={ctx?.owners ?? props.owners}
        org={org}
      />
    </div>
  );
}
