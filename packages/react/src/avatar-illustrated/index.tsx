// @bridge-ds/react/avatar-illustrated: the Avatar with its illustrated fallback filled in. A separate entry because
// the drawings (the DiceBear "Notionists" style, design CC0 1.0 by Zoish, code MIT) weigh about 120 kB gzipped:
// products that only need initials never load them. The faces are generated locally from the seed, no network.
//
//   import { Avatar } from '@bridge-ds/react/avatar-illustrated';
//   <Avatar name="Ana Lima" seed="analima" fallback="illustrated" />
import { forwardRef, useMemo, type ComponentProps } from 'react';
import { createAvatar } from '@dicebear/core';
import { notionists } from '@dicebear/collection';
import { Avatar as BaseAvatar, type AvatarProps } from '../components/Avatar';

const cache = new Map<string, string>();

/**
 * The illustrated face for a seed as an SVG string, transparent so the Avatar paints the Harbor zone color behind
 * it. The same seed always gives the same face. No hands or body icons, and framed on the face (zoomed in, moved down): at 20 to 40px a whole bust is noise.
 */
export function illustratedAvatarSvg(seed: string): string {
  return createAvatar(notionists, { seed: seed.trim().toLowerCase() || '?', gestureProbability: 0, bodyIconProbability: 0, scale: 125, translateY: 12 }).toString();
}

/** The illustrated face for a seed as a data URI, ready for an image `src` (memoized per seed). */
export function illustratedAvatarUri(seed: string): string {
  const key = seed.trim().toLowerCase();
  let uri = cache.get(key);
  if (!uri) {
    uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(illustratedAvatarSvg(key))}`;
    if (cache.size > 500) cache.clear();
    cache.set(key, uri);
  }
  return uri;
}

const IllustratedAvatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(props, ref) {
  const wants = props.fallback === 'illustrated' && props.kind !== 'agent' && !props.illustration;
  const seed = props.seed ?? props.name ?? '';
  const illustration = useMemo(() => (wants ? illustratedAvatarUri(seed) : undefined), [wants, seed]);
  return <BaseAvatar ref={ref} {...(props as ComponentProps<typeof BaseAvatar>)} {...(illustration ? { illustration } : {})} />;
});

/** The Bridge Avatar; with `fallback="illustrated"` it draws a face from `seed` (default: the name). Same props as the main Avatar. */
export const Avatar = IllustratedAvatar as typeof BaseAvatar;

export { AvatarGroup } from '../components/Avatar';
export type { AvatarProps, AvatarGroupProps, AvatarFallback, AvatarKind, AvatarAgentBrand, AvatarSize } from '../components/Avatar';
