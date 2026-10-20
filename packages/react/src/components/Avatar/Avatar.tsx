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
  /** With `kind="agent"`: `claude` shows the Claude mark on a cream tile, named "Claude AI". */
  brand?: AvatarAgentBrand;
}

/** A person: the name is required. */
export type AvatarPersonProps = Omit<AvatarProps, 'kind' | 'name' | 'brand'> & { kind?: 'person'; name: string; brand?: never };
/** An agent preset: the brand is required, the name defaults to the brand's ("Claude AI"). */
export type AvatarAgentProps = Omit<AvatarProps, 'kind' | 'brand'> & { kind: 'agent'; brand: AvatarAgentBrand };

/** Accessible names of the agent presets. */
export const AVATAR_AGENT_NAMES: Record<AvatarAgentBrand, string> = { claude: 'Claude AI' };

/**
 * The Claude mark (simple-icons `siClaude`, CC0 path) and its brand color. The mark is an Anthropic trademark, used
 * here only to attribute work Claude did; check the Anthropic brand guidelines before shipping it in a product.
 */
export const CLAUDE_MARK = {
  color: '#D97757',
  path: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
} as const;

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
  { name, kind, brand, src, size = 'md', decorative = false, fallback = 'initials', seed: _seed, illustration, className, ...rest },
  ref,
) {
  const agent = kind === 'agent' && brand === 'claude';
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
        <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill={CLAUDE_MARK.color} d={CLAUDE_MARK.path} />
        </svg>
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
