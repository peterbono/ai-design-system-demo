// The two small blocks Settings > Members and the Invite collaborators dialog share (similarity: the same person reads
// the same way in both): a person with their muted line, and the calm status line after an action.
import type { ReactNode } from 'react';
import { Link, Tag } from '@bridge-ds/react';
import { Who } from './faces';
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

/**
 * A person: avatar, name (and "(you)"), one muted line. The same block in the table and in the dialog. The avatar is
 * the home's (faces.tsx Who): the GitHub photo when there is one, else the drawn face seeded by `seed`, so a person
 * looks the same on every Studio page. Not joined yet: a dashed ring, and the words say it too. An email contributor
 * gets one "Email" tag inline after the name (never right-aligned).
 */
export function PersonCell({ name, seed, line, you, avatar, pending, tag, size = 'sm' }: { name: string; seed: string; line: ReactNode; you?: boolean; avatar?: string; pending?: boolean; /** One small tag inline after the name ("Email"). */ tag?: string; size?: 'xs' | 'sm' }) {
  return (
    <span className="mem-person">
      <Who p={{ login: seed, name, avatar: avatar ?? null }} size={size} className={pending ? 'mem-avatar-pending' : undefined} />
      <span className="mem-person-text">
        <span className="mem-name">
          {name}
          {you && <span className="mem-you"> (you)</span>}
          {tag && (
            <Tag size="sm" className="mem-tag">
              {tag}
            </Tag>
          )}
        </span>
        <span className="mem-line">{line}</span>
      </span>
    </span>
  );
}
