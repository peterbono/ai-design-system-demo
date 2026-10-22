// The two small blocks Settings > Members and the Invite collaborators dialog share (similarity: the same person reads
// the same way in both): a person with their muted line, and the calm status line after an action.
import { Avatar, Link } from '@bridge-ds/react';
import type { Notice } from './members-state';

/** The calm line after an action (role=status), with the settings change to approve when there is one. */
export function NoticeLine({ notice }: { notice: Notice | null }) {
  return (
    <p className="mem-notice" role="status" data-tone={notice?.tone}>
      {notice?.text}
      {notice?.link && (
        <>
          {' '}
          <Link href={notice.link.href} external>
            {notice.link.label}
          </Link>
        </>
      )}
    </p>
  );
}

/** A person: avatar, name (and "(you)"), one muted line. The same block in the table and in the dialog. */
export function PersonCell({ name, line, you, avatar, pending, size = 'sm' }: { name: string; line: string; you?: boolean; avatar?: string; pending?: boolean; size?: 'xs' | 'sm' }) {
  return (
    <span className="mem-person">
      <Avatar name={name} src={avatar} size={size} decorative className={pending ? 'mem-avatar-pending' : undefined} />
      <span className="mem-person-text">
        <span className="mem-name">
          {name}
          {you && <span className="mem-you"> (you)</span>}
        </span>
        <span className="mem-line">{line}</span>
      </span>
    </span>
  );
}
