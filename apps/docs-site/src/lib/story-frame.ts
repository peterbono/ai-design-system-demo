// The drawer preview of a team's story (TeamComponents.tsx) sizes to the story instead of a fixed height. A Storybook
// opened with `embed=bridge` (Bridge's own, .storybook/preview.tsx) drops its full-viewport canvas, centers the story
// and posts its document height to the parent; the frame takes that height, kept between the CSS min and max. A
// Storybook that does not post keeps the frame's resting height (the CSS min). Pure: no DOM.

/** The query parameter that asks a Storybook story for the embedded canvas (sized to the story, height posted). */
export const STORY_EMBED_PARAM = 'embed';
export const STORY_EMBED_VALUE = 'bridge';
/** The message type a story embedded that way posts to its parent. */
export const STORY_HEIGHT_MESSAGE = 'bridge:story-height';

/** A story iframe URL with the embed parameter appended. */
export const embedStoryUrl = (src: string): string => `${src}${src.includes('?') ? '&' : '?'}${STORY_EMBED_PARAM}=${STORY_EMBED_VALUE}`;

/** The height a story posted, in CSS pixels, or null when the message is not a sane story height. */
export function postedStoryHeight(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const { type, height } = data as { type?: unknown; height?: unknown };
  if (type !== STORY_HEIGHT_MESSAGE || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  // A runaway page (a story that grows with its frame) stops at a bound far above any CSS max.
  return Math.min(Math.ceil(height), 10000);
}
