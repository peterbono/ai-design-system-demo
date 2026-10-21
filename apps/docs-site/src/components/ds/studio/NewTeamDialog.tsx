// "Create a new team", from the team chip menu (TeamChip.tsx): a DS Dialog over the page, so the person keeps their
// place. One field takes owner/repo or a GitHub address (lib/team-open.ts, the same parser and words as the launcher
// on Studio home); "Open team" goes to that team's Studio. While they type, after a short pause, one calm line says
// what they will find there (core resolveRepoAccess through the session, cached per repository): Ready, Read only,
// Bridge is not installed yet (with "Install Bridge" for an admin), Not found or private, or Sign in to check.
// Signed out it asks GitHub at most once per repository, anonymously; when GitHub stops answering it stops asking.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge, Button, ButtonGroup, Dialog, DialogClose, DialogContent, Icon, Input, Link, Spinner } from '@bridge-ds/react';
import type { RepoAccessState } from '@bridge-ds/core';
import { GitHubMark } from './brand-icons';
import '../../../styles/new-team.css';
import { installUrl } from '../../../lib/access-view';
import { loadReserved, openTeamHref, readTeamField, TEAM_CHECK_DEBOUNCE_MS, teamCheck, type TeamCheck } from '../../../lib/team-open';

/** What GitHub says about one repository for this viewer; null when it could not be asked. */
export type TeamAccessCheck = (owner: string, repo: string) => Promise<{ state: RepoAccessState; repoAdmin?: boolean | undefined } | null>;

export interface NewTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Signed in with GitHub: the check can say what the viewer can do. */
  signedIn: boolean;
  /** The access check; leave it out to skip the live line. */
  check?: TeamAccessCheck;
  /** Where to go, swapped in tests. */
  go?: (href: string) => void;
}

type Line = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; check: TeamCheck };

export default function NewTeamDialog({ open, onOpenChange, signedIn, check, go = (href) => location.assign(href) }: NewTeamDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line>({ kind: 'idle' });
  const input = useRef<HTMLInputElement>(null);
  // GitHub stopped answering (rate limit, network): no more checks until the dialog opens again.
  const paused = useRef(false);
  const formId = `${useId()}-team`;

  // Cleared when it closes, not when it opens: the first keystroke must never be wiped.
  useEffect(() => {
    if (open) {
      void loadReserved();
      return;
    }
    setValue('');
    setError(null);
    setBusy(false);
    setLine({ kind: 'idle' });
    paused.current = false;
  }, [open]);

  // The live line: only for a complete repository name, after a pause in typing; the latest answer wins.
  useEffect(() => {
    if (!open || !check) return;
    const field = readTeamField(value);
    if (!field.ok || paused.current) {
      setLine({ kind: 'idle' });
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      setLine({ kind: 'checking' });
      check(field.owner, field.repo)
        .catch(() => null)
        .then((r) => {
          if (!live) return;
          if (!r) paused.current = true;
          const c = teamCheck(r?.state ?? null, { signedIn, repoAdmin: r?.repoAdmin });
          setLine(c ? { kind: 'done', check: c } : { kind: 'idle' });
        });
    }, TEAM_CHECK_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [value, open, check, signedIn]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const field = readTeamField(value);
    if (!field.ok) {
      setError(field.message);
      input.current?.focus();
      return;
    }
    setBusy(true);
    go(await openTeamHref(field.owner, field.repo));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)} disablePointerDismissal={value.trim() !== ''}>
      <DialogContent
        className="nt"
        title="Create a new team"
        description="Connect your design system's GitHub repository. Your team opens the same link and signs in with GitHub."
        initialFocus={input}
        hideClose
        footer={
          <ButtonGroup align="end" className="nt-actions">
            <DialogClose render={<Button variant="secondary" disabled={busy} />}>Cancel</DialogClose>
            <Button type="submit" form={formId} variant="primary" iconEnd={ArrowRight} loading={busy} disabled={busy}>
              Open team
            </Button>
          </ButtonGroup>
        }
      >
        <form id={formId} className="nt-form" onSubmit={submit} noValidate>
          <Input
            ref={input}
            label="GitHub repository"
            prefix={<Icon icon={GitHubMark} size="sm" />}
            placeholder="owner/repo or github.com address"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            onValueChange={(v) => {
              setValue(v);
              if (error) setError(null);
            }}
            error={error ?? undefined}
          />
          {/* Always mounted, so a screen reader hears each new line; empty (and not shown) while there is nothing to say. */}
          <div className="nt-status" role="status" aria-live="polite">
            {!error && line.kind === 'checking' && (
              <>
                <Spinner size="xs" />
                <span className="nt-status-text">Checking on GitHub</span>
              </>
            )}
            {!error && line.kind === 'done' && (
              <>
                <Badge size="sm" tone={line.check.tone} dot className="nt-badge">
                  {line.check.label}
                </Badge>
                <span className="nt-status-text">
                  {line.check.text}
                  {line.check.install && (
                    <>
                      {' '}
                      <Link href={installUrl()} external>
                        Install Bridge
                      </Link>
                    </>
                  )}
                </span>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
