// Library version picker in the top bar. A hydrated island (client:idle): DS Popover with the current version, the
// tagged past releases (archived docs are not built yet, so they are listed as unavailable) and a link to the notes.
import { Button, Link, Popover, PopoverContent, PopoverTrigger } from '@bridge-ds/react';
import { Check, ChevronDown, Tag } from 'lucide-react';

export interface VersionMenuProps {
  current: string;
  past: string[];
  branch: string;
  sha: string;
  /** Unreleased changes waiting for the next release. */
  pending: number;
  /** Trigger tooltip: where the build comes from. */
  builtFrom: string;
}

export default function VersionMenu({ current, past, branch, sha, pending, builtFrom }: VersionMenuProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" iconStart={Tag} iconEnd={ChevronDown} aria-label={`Library version ${current}. Change version`} title={builtFrom} />}
      >
        <span className="mono">{current}</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" arrow={false} title="Version" className="shell-pop">
        <ul className="shell-version-list">
          <li aria-current="true">
            <span className="shell-version-name">
              <span className="mono">{current}</span>
              <span className="shell-version-note">
                Latest, built from {branch} at <span className="mono">{sha}</span>
              </span>
            </span>
            <Check aria-label="Current version" className="shell-version-check" />
          </li>
          {past.map((name) => (
            <li key={name} aria-disabled="true" title="Archived docs for past versions are coming soon">
              <span className="shell-version-name">
                <span className="mono">{name}</span>
                <span className="shell-version-note">Archived docs coming soon</span>
              </span>
            </li>
          ))}
        </ul>
        {past.length === 0 && <p className="shell-pop-help">No earlier release is tagged yet. Archived docs for past versions are coming soon.</p>}
        <p className="shell-pop-foot">
          <Link href="/changelog/" variant="standalone">
            Release notes
          </Link>
          {pending > 0 && <span className="shell-version-note"> and {pending} unreleased changes</span>}
        </p>
      </PopoverContent>
    </Popover>
  );
}
