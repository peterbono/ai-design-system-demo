// Settings > Account: who Studio acts as. Connected, it is one compact row: avatar, "Connected as @login", the access
// as a status badge, and "Change token" as a quiet action (its dialog also disconnects). Read only or with a token
// GitHub refused, it becomes the page's one Harbor zone: a Field Guide drawing (passed as children from Astro), one
// sentence and the one primary action. State comes from the shared GitHub session (scripts/github-session.ts).
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, Badge, Button, Card, CardBody } from '@bridge-ds/react';
import { GitHubMark } from './brand-icons';
import { accountView, type AccountState } from '../../../lib/settings-view';
import { currentViewer, getToken, initGitHubConnect, onAccess, tokenRejected, type Viewer } from '../../../scripts/github-session';

export interface SettingsAccountProps {
  /** owner/repo, as the page reads it. */
  repo: string;
  /** The Field Guide drawing shown while Studio is read only. */
  children?: ReactNode;
}

export default function SettingsAccount({ repo, children }: SettingsAccountProps) {
  // The server renders "checking": the token lives in this browser only.
  const [state, setState] = useState<AccountState>('checking');
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [write, setWrite] = useState<boolean | null>(null);

  useEffect(() => {
    const read = (v: Viewer | null) => {
      setViewer(v);
      setState(v ? 'connected' : tokenRejected() ? 'rejected' : 'readonly');
      if (!v) setWrite(null);
    };
    if (!getToken()) setState('readonly');
    initGitHubConnect(read);
    onAccess((a) => setWrite(a ? a.write : null));
    const onAuth = () => read(currentViewer());
    document.addEventListener('bridge:auth', onAuth);
    return () => document.removeEventListener('bridge:auth', onAuth);
  }, []);

  const view = accountView(state, { login: viewer?.login, write, repo });

  if (view.zone) {
    return (
      <div className="zone set-account set-account-zone" data-state={state}>
        <div className="set-account-art" aria-hidden="true">
          {children}
        </div>
        <div className="set-account-text">
          <p className="set-account-title">{view.title}</p>
          <p className="set-account-sub">{view.detail}</p>
        </div>
        <Button variant="primary" iconStart={GitHubMark} data-gh-open className="set-account-action">
          {view.action}
        </Button>
      </div>
    );
  }

  return (
    <Card data-state={state}>
      <CardBody>
        <div className="set-account" aria-live="polite">
          {viewer && <Avatar name={viewer.name || viewer.login} src={`${viewer.avatar_url}${viewer.avatar_url.includes('?') ? '&' : '?'}s=64`} size="md" decorative />}
          <div className="set-account-text">
            <p className="set-account-title">
              {view.title}
              {view.badge && (
                <Badge tone={view.badge.tone} size="sm" dot>
                  {view.badge.label}
                </Badge>
              )}
            </p>
            {view.detail && <p className="set-account-sub">{view.detail}</p>}
          </div>
          {view.action && (
            <Button variant="ghost" data-gh-open className="set-account-action">
              {view.action}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
