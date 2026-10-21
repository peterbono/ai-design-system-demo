// The Library <-> Studio switch at the end of the top bar (the owner's pill): a white pill names the space you are in,
// on a Deep Harbor track; the other space waits at the end of the track as one drawn icon (pen and notes for Studio,
// an open book for the Library). One link, not a button or a switch: it loads the other space, carrying the page's
// item across (lib/space-switch.ts). Rendered statically by the layout (no hydration); scripts/space-switch.ts plays
// the slide on click, refreshes the target where the query or the team decides it, and the first-visit hint.
// Styles: styles/space-switch.css.
import { Avatar, Link } from '@bridge-ds/react';
import { currentLabel, switchLabel, switchTooltip, type SwitchSpace } from '../lib/space-switch';

export const SPACE_SWITCH_NOW_ID = 'space-switch-now';

export interface SpaceSwitchProps {
  /** The space this page is in: its word shows on the pill. */
  space: SwitchSpace;
  /** Where the link goes (lib/space-switch.ts switchTarget). */
  href: string;
  /** The item carried across ("Button"), for the tooltip. */
  item?: string | null;
}

/** Pen and notes: two lines of notes, a scribble the pen writes on hover, and the pen. 20 by 20, stroked. */
function PenIcon() {
  return (
    <svg className="ss-glyph" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d="M3.2 5.2h6.2M3.2 8.6h4.4" />
      <path className="ss-scrib" pathLength={1} d="M3 15.6c1.2-1.6 2.2 1 3.4-.4s2-1.2 2.8.2 2 .2 2.6-.8" />
      <g className="ss-nib">
        <path d="M15.6 2.6l2 2-7.4 7.4-2.8.8.8-2.8z" />
        <path d="M14.2 4l2 2" />
      </g>
    </svg>
  );
}

/** Open book: two pages and a spine, with a leaf that turns on hover. */
function BookIcon() {
  return (
    <svg className="ss-glyph" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d="M10 5.4C8.2 4 5.6 3.8 2.8 4.8v10.6c2.8-1 5.4-.8 7.2.6" />
      <path d="M10 5.4c1.8-1.4 4.4-1.6 7.2-.6v10.6c-2.8-1-5.4-.8-7.2.6" />
      <path d="M10 5.4V16" />
      <path className="ss-leaf" d="M10 5.4c1.4-.9 3-1.2 4.8-1v10.2c-1.8-.2-3.4.1-4.8 1" />
    </svg>
  );
}

export default function SpaceSwitch({ space, href, item = null }: SpaceSwitchProps) {
  return (
    <Link
      variant="subtle"
      className="space-switch"
      href={href}
      aria-label={switchLabel(space)}
      aria-describedby={SPACE_SWITCH_NOW_ID}
      data-space-switch=""
      data-switch-space={space}
      data-mode={space}
      data-switch-item={item ?? undefined}
      data-tooltip={switchTooltip(space, item)}
      data-tooltip-side="bottom"
    >
      <span className="ss-icon ss-to-library" aria-hidden="true">
        <BookIcon />
      </span>
      <span className="ss-icon ss-to-studio" aria-hidden="true">
        <PenIcon />
        {/* A signed-in maintainer sees their face here instead of the pen (scripts/maintainer.ts paints it). */}
        {space === 'library' && (
          <span className="ss-avatar" data-team-avatar="" hidden>
            <Avatar name="Studio" size="xs" decorative data-team-avatar-img="" />
          </span>
        )}
      </span>
      <span className="ss-hint" aria-hidden="true" />
      <span className="ss-pill" aria-hidden="true">
        <span className="ss-word">
          <span data-when="library">Library</span>
          <span data-when="studio">Studio</span>
        </span>
      </span>
      <span className="sr-only" id={SPACE_SWITCH_NOW_ID}>
        {currentLabel(space)}
      </span>
    </Link>
  );
}
