import { Children, forwardRef, isValidElement, type HTMLAttributes, type ReactNode } from 'react';
import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { cx } from '../../utils/cx';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Full name. Used for the initials fallback and as the accessible name. */
  name: string;
  /** Image URL. While it loads or if it fails, the initials show instead. */
  src?: string;
  /** xs 20, sm 24, md 32, lg 40. Default `md`. */
  size?: AvatarSize;
  /** Hide from assistive tech when the name is already written next to the avatar. */
  decorative?: boolean;
}

/** Initials from a name: first letter of the first and last words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** A person or a team: photo with an initials fallback (Base UI Avatar). */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, src, size = 'md', decorative = false, className, ...rest },
  ref,
) {
  return (
    <BaseAvatar.Root
      ref={ref}
      className={cx(styles.avatar, styles[size], className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      {...rest}
    >
      {src && <BaseAvatar.Image className={styles.image} src={src} alt="" />}
      <BaseAvatar.Fallback className={styles.fallback} aria-hidden="true">
        {initials(name)}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
});

export interface AvatarGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible name of the group, for example "Reviewers". */
  'aria-label': string;
  /** Show at most this many avatars; the rest collapse into a "+N" counter. */
  max?: number;
  size?: AvatarSize;
  children: ReactNode;
}

/** Overlapping stack of avatars with a "+N" overflow counter. */
export const AvatarGroup = forwardRef<HTMLDivElement, AvatarGroupProps>(function AvatarGroup(
  { max = 4, size = 'md', className, children, ...rest },
  ref,
) {
  const items = Children.toArray(children).filter(isValidElement);
  const shown = items.slice(0, max);
  const hidden = items.slice(max);
  const hiddenNames = hidden
    .map((child) => (child.props as { name?: string }).name)
    .filter(Boolean)
    .join(', ');
  return (
    <div ref={ref} role="group" className={cx(styles.group, styles[size], className)} {...rest}>
      {shown}
      {hidden.length > 0 && (
        <span className={cx(styles.avatar, styles.overflow, styles[size])} role="img" aria-label={`${hidden.length} more${hiddenNames ? `: ${hiddenNames}` : ''}`} title={hiddenNames || undefined}>
          <span aria-hidden="true">+{hidden.length}</span>
        </span>
      )}
    </div>
  );
});
