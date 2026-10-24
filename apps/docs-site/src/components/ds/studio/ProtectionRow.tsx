// Settings > Safety > Protection: one row of the Safety card, the same row as the visual before and after. It says
// whether every change to the library goes through review and, when not, offers one action on the same row:
// "Protect the library" (or "Complete protection"). The action confirms in a DS Dialog that says what changes in plain
// words, with a "How it works on GitHub" link for the GitHub terms, then creates the repository ruleset with the
// viewer's token. Refusals
// (not an admin, a token without Administration, a plan without rulesets) get one sentence and a link to GitHub
// settings, never silence.
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  ButtonGroup,
  Dialog,
  DialogClose,
  DialogContent,
  Link,
} from '@bridge-ds/react';
import { loadProtection, loadRequiredChecks, protectLibrary, protectRefusal, rulesSettingsUrl } from '@bridge-ds/core';
import { protectionRow, RULESETS_HELP_URL, type ProtectionRowState } from '../../../lib/protection-view';
import { VOCAB } from '../../../lib/vocabulary';
import { hasWorkingToken, initGitHubConnect, prefersSignIn, readRepo, studioClient } from '../../../scripts/github-session';

export default function ProtectionRow() {
  const [state, setState] = useState<ProtectionRowState>({ kind: 'loading' });
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState({ owner: '', repo: '', defaultBranch: 'main' });
  const rulesUrl = repo.owner ? rulesSettingsUrl(repo.owner, repo.repo) : 'https://github.com';

  const refresh = useCallback(async () => {
    const r = readRepo();
    setRepo(r);
    if (!hasWorkingToken()) {
      setState({ kind: 'no-token' });
      return;
    }
    const gh = studioClient(`${r.owner}/${r.repo}`);
    const [s, info] = await Promise.all([loadProtection(gh, r.defaultBranch), gh.getRepo().catch(() => null)]);
    setAdmin(info?.permissions ? Boolean(info.permissions.admin) : null);
    setState(s);
  }, []);

  useEffect(() => {
    const run = () => void refresh();
    initGitHubConnect(run);
    document.addEventListener('bridge:auth', run);
    return () => document.removeEventListener('bridge:auth', run);
  }, [refresh]);

  const view = protectionRow(state, rulesUrl, state.kind === 'no-token' && prefersSignIn());

  const start = () => {
    setError(null);
    setOpen(true);
    if (checks === null) {
      const r = readRepo();
      void loadRequiredChecks(studioClient(`${r.owner}/${r.repo}`), r.defaultBranch).then(setChecks, () => setChecks([]));
    }
  };

  const confirm = async () => {
    if (admin === false) {
      setError('Only a repository admin can protect the library. Ask an admin, or set it up in GitHub settings.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = readRepo();
      const gh = studioClient(`${r.owner}/${r.repo}`);
      await protectLibrary(gh, r.defaultBranch, { checks: checks ?? [], approvals: 1, adminBypass: true, ...('missing' in state ? { state } : {}) });
      setOpen(false);
      setState(await loadProtection(gh, r.defaultBranch));
    } catch (err) {
      setError(protectRefusal(err) ?? `GitHub did not turn protection on: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="set-row" id="protection">
      <p className="set-row-label">Protection</p>
      <p className="set-row-value" aria-live="polite">
        {view.text}
      </p>
      {(view.action || view.link) && (
        <div className="set-row-action">
          {view.action && (
            <Button variant="primary" onClick={start} data-protect-action>
              {view.action}
            </Button>
          )}
          {view.link && (
            <Link href={view.link.href} external>
              {view.link.label}
            </Link>
          )}
        </div>
      )}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent
          title="Protect the library?"
          description={`Every tool then changes ${repo.repo || 'the library'} the same way: Studio, the Figma plugin, Claude and developers.`}
          footer={
            <ButtonGroup align="end">
              <DialogClose render={<Button variant="secondary" disabled={busy} />}>Cancel</DialogClose>
              <Button variant="primary" loading={busy} disabled={busy || checks === null} onClick={() => void confirm()}>
                {busy ? 'Protecting' : view.action ?? 'Protect the library'}
              </Button>
            </ButtonGroup>
          }
        >
          <ul className="set-protect-list">
            <li>
              <strong>Every change goes through review.</strong> Someone approves it before it is added to the library.
            </li>
            <li>
              <strong>Checks must pass.</strong>{' '}
              {checks === null ? 'Reading your checks from GitHub.' : checks.length ? `The ${checks.length} checks your team already runs must pass before a change is added to the library.` : 'Your repository runs no checks yet, so only review applies.'}
            </li>
            <li>
              <strong>Nobody rewrites history.</strong> Changes in the library stay as they are, and nobody can delete the library.
            </li>
          </ul>
          <p className="set-protect-note">
            Owners can still merge from Studio. Repository admins keep the override: they may merge a branch before its approvals, but never change main directly.{' '}
            <Link href={RULESETS_HELP_URL} external>
              {VOCAB.howOnGitHub}
            </Link>
          </p>
          {error && (
            <Alert tone="danger" className="set-protect-error">
              {error}{' '}
              <Link href={rulesUrl} external>
                Open GitHub settings
              </Link>
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
