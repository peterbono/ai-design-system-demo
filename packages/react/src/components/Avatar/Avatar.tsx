import { Children, forwardRef, isValidElement, type ForwardRefExoticComponent, type HTMLAttributes, type ReactNode, type RefAttributes } from 'react';
import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { cx } from '../../utils/cx';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';
/** What shows when there is no photo, or while it loads, or when it fails. */
export type AvatarFallback = 'initials' | 'illustrated';
/** A person (or a team), or an AI agent acting in the product. */
export type AvatarKind = 'person' | 'agent';
/** Agent identities the system ships. */
export type AvatarAgentBrand = 'claude';

/**
 * Every Avatar prop in one interface (tooling reads it: docs tables, Figma specs). The component is typed with the
 * stricter AvatarPersonProps | AvatarAgentProps: a person needs a name, an agent preset needs its brand.
 */
export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Full name. Used for the initials fallback and as the accessible name. Optional for an agent preset. */
  name?: string;
  /** Image URL. While it loads or if it fails, the fallback shows instead. */
  src?: string;
  /** xs 20, sm 24, md 32, lg 40. Default `md`. */
  size?: AvatarSize;
  /** Hide from assistive tech when the name is already written next to the avatar. */
  decorative?: boolean;
  /**
   * `initials` (default) or `illustrated`: a drawn face that is always the same for the same seed. The drawing comes
   * from `illustration`; the Avatar exported by `@bridge-ds/react/avatar-illustrated` fills it from the seed for you.
   */
  fallback?: AvatarFallback;
  /** What the illustrated face is drawn from, for example a login. Default: the name. */
  seed?: string;
  /** Image (URL or data URI) of the illustrated face. Without it, `fallback="illustrated"` shows initials. */
  illustration?: string;
  /** `person` (default), or `agent`: an AI acting in the product, so people can tell its work from a person's. */
  kind?: AvatarKind;
  /** With `kind="agent"`: `claude` names the agent "Claude AI" and shows the Bridge agent mark, the Field Guide robot, on its tile. */
  brand?: AvatarAgentBrand;
  /**
   * With `kind="agent"`: replaces the Bridge agent mark (the Field Guide robot), for example with a vendor logo (an SVG that fills its box).
   * Only for a logo you have the brand owner's approval to use. Decorative: the name stays the accessible name.
   */
  mark?: ReactNode;
}

/** A person: the name is required. */
export type AvatarPersonProps = Omit<AvatarProps, 'kind' | 'name' | 'brand' | 'mark'> & { kind?: 'person'; name: string; brand?: never; mark?: never };
/** An agent preset: the brand is required, the name defaults to the brand's ("Claude AI"). */
export type AvatarAgentProps = Omit<AvatarProps, 'kind' | 'brand'> & { kind: 'agent'; brand: AvatarAgentBrand };

/** Accessible names of the agent presets. */
export const AVATAR_AGENT_NAMES: Record<AvatarAgentBrand, string> = { claude: 'Claude AI' };

/**
 * The agent mark: the Field Guide robot (a rounded head with an antenna, two dot eyes, a smile, side ears and two legs)
 * in the Bridge line style: one stroke in currentColor, round caps, no fill, so the tile shows through in light and
 * dark. The eyes and the antenna tip are tiny circles the stroke fills in, so the whole robot is one path that reads
 * from 16px up. Bridge draws its own mark instead of shipping a vendor logo: company logos are trademarks that need
 * their owner's approval for each use. A team with that approval can pass its logo to the `mark` prop.
 */
export const AGENT_MARK = {
  viewBox: '0 -0.8 24 24',
  path: 'M11.4 2.4a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0M12 3V6.1M6.2 6.4C9.6 5.9 14.6 6 17.9 6.5C19.1 6.7 19.6 7.6 19.6 8.9L19.4 15.6C19.3 17 18.6 17.7 17.3 17.8C13.9 18.1 9.8 18.1 6.6 17.8C5.3 17.7 4.6 17 4.5 15.6L4.4 8.9C4.4 7.5 5 6.6 6.2 6.4ZM8.6 11.2a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0M14.2 11.2a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0M9.6 14.6Q12 15.8 14.4 14.6M4.4 10.6H2.9M19.6 10.6H21.1M8.6 18V20.6M15.4 18V20.6',
  strokeWidth: 1.8,
  color: 'currentColor',
} as const;

/**
 * @deprecated Use `AGENT_MARK`. Kept so existing imports work; it is now the Bridge agent mark, not a vendor logo.
 * Draw it as a stroke (`fill="none" stroke={color} stroke-width={strokeWidth}`), not as a fill.
 */
export const CLAUDE_MARK = AGENT_MARK;

/** Initials from a name: first letter of the first and last words. */
export function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** The accessible name an avatar gets: its name, else the agent preset's name. */
export function avatarName(props: { name?: string; kind?: AvatarKind; brand?: AvatarAgentBrand }): string {
  if (props.name) return props.name;
  return props.kind === 'agent' && props.brand ? AVATAR_AGENT_NAMES[props.brand] : '';
}

/** A person, a team or an AI agent: photo with an initials or illustrated fallback (Base UI Avatar). */
const AvatarBase = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, kind, brand, mark, src, size = 'md', decorative = false, fallback = 'initials', seed: _seed, illustration, className, ...rest },
  ref,
) {
  const agent = kind === 'agent';
  // The accessible name: the name, else the agent preset's ("Claude AI").
  const label = avatarName({ name, kind, brand });
  const drawn = !agent && fallback === 'illustrated' && Boolean(illustration);
  return (
    <BaseAvatar.Root
      ref={ref}
      className={cx(styles.avatar, styles[size], agent && styles.agent, drawn && styles.illustrated, className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      {...rest}
    >
      {agent ? (
        mark ? (
          <span className={styles.custom} aria-hidden="true">
            {mark}
          </span>
        ) : (
          // The path is AGENT_MARK.path written out (a test keeps them equal), so the Figma specs can read the drawing.
          <svg className={styles.mark} viewBox="0 -0.8 24 24" fill="none" aria-hidden="true" focusable="false">
            <path className={styles.line} d="M11.4 2.4a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0M12 3V6.1M6.2 6.4C9.6 5.9 14.6 6 17.9 6.5C19.1 6.7 19.6 7.6 19.6 8.9L19.4 15.6C19.3 17 18.6 17.7 17.3 17.8C13.9 18.1 9.8 18.1 6.6 17.8C5.3 17.7 4.6 17 4.5 15.6L4.4 8.9C4.4 7.5 5 6.6 6.2 6.4ZM8.6 11.2a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0M14.2 11.2a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0M9.6 14.6Q12 15.8 14.4 14.6M4.4 10.6H2.9M19.6 10.6H21.1M8.6 18V20.6M15.4 18V20.6" />
          </svg>
        )
      ) : (
        <>
          {src && <BaseAvatar.Image className={styles.image} src={src} alt="" />}
          <BaseAvatar.Fallback className={styles.fallback} aria-hidden="true">
            {drawn ? <img className={styles.illustration} src={illustration} alt="" /> : initials(name)}
          </BaseAvatar.Fallback>
        </>
      )}
    </BaseAvatar.Root>
  );
});

/** A person, a team or an AI agent: photo with an initials or illustrated fallback (Base UI Avatar). */
export const Avatar = AvatarBase as ForwardRefExoticComponent<(AvatarPersonProps | AvatarAgentProps) & RefAttributes<HTMLSpanElement>>;

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
    .map((child) => avatarName(child.props as { name?: string; kind?: AvatarKind; brand?: AvatarAgentBrand }))
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
