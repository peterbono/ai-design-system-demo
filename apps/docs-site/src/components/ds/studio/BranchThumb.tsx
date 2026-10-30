// The before/after thumbnail of a branch (Studio home rows and cards). Draws a ThumbSpec from lib/branch-thumb.ts:
// two halves split by a dashed line, the after half on the subtle surface, or one centred icon when there is no
// before/after to show, or one explored screen (an exploration card: its capture, else a sketch). Decorative: the row or card next to it says the same thing in words. Styles:
// styles/branch-thumb.css.
import type { ReactNode } from 'react';
import { BookOpen, Component, Contrast, GitBranch, Palette, UserPlus } from 'lucide-react';
import { Icon, type LucideIcon } from '@bridge-ds/react';
import { fitScale, type ThumbIcon, type ThumbSpec } from '../../../lib/branch-thumb';

type ThumbSize = 'row' | 'card';

const ICONS: Record<ThumbIcon, LucideIcon> = {
  component: Component,
  token: Palette,
  guidance: BookOpen,
  branch: GitBranch,
  contrast: Contrast,
  person: UserPlus,
};

// The px room a drawn value gets inside one half. Row halves are 32 by 40, card halves at least 120 by 136; data
// larger than that shrinks with its pair so the before/after ratio stays true.
const ROOM: Record<ThumbSize, { bar: number; type: number; radiusScale: number }> = {
  row: { bar: 28, type: 18, radiusScale: 0.5 },
  card: { bar: 120, type: 64, radiusScale: 1 },
};

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

function Halves({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <>
      <span className="bt-half bt-before">{before}</span>
      <span className="bt-half bt-after">{after}</span>
    </>
  );
}

function Swatch({ hex }: { hex: string | null }) {
  // Data colour, not a style literal: the token's resolved value. A missing side (added or removed) is an outline.
  return hex ? <span className="bt-swatch" style={{ background: hex }} /> : <span className="bt-swatch bt-none" />;
}

function Bar({ value, scale }: { value: number | null; scale: number }) {
  if (value == null) return <span className="bt-bar bt-none" />;
  return <span className="bt-bar" style={{ width: `min(${px(Math.max(value, 0) * scale)}, 100%)` }} />;
}

function Corner({ value, scale }: { value: number | null; scale: number }) {
  if (value == null) return <span className="bt-shape bt-none" />;
  return <span className="bt-shape" style={{ borderRadius: px(Math.max(value, 0) * scale) }} />;
}

function Glyphs({ value, scale }: { value: number | null; scale: number }) {
  if (value == null) return <span className="bt-glyph bt-none" />;
  return (
    <span className="bt-glyph" style={{ fontSize: px(value * scale) }}>
      Aa
    </span>
  );
}

function Lines() {
  return (
    <span className="bt-lines">
      <span className="bt-line" />
      <span className="bt-line" />
      <span className="bt-line" />
      <span className="bt-line" />
    </span>
  );
}

/** A screen not captured yet: a title bar, a heading and two blocks, drawn with the thumbnail's own lines. */
function ScreenSketch() {
  return (
    <span className="bt-sketch">
      <span className="bt-sketch-head" />
      <span className="bt-sketch-block" />
      <span className="bt-sketch-block" />
    </span>
  );
}

function body(spec: ThumbSpec, size: ThumbSize): ReactNode {
  const room = ROOM[size];
  switch (spec.kind) {
    case 'color':
      return <Halves before={<Swatch hex={spec.before} />} after={<Swatch hex={spec.after} />} />;
    case 'space': {
      const s = fitScale(spec.before, spec.after, room.bar);
      return <Halves before={<Bar value={spec.before} scale={s} />} after={<Bar value={spec.after} scale={s} />} />;
    }
    case 'radius': {
      const s = room.radiusScale;
      return <Halves before={<Corner value={spec.before} scale={s} />} after={<Corner value={spec.after} scale={s} />} />;
    }
    case 'type': {
      const s = fitScale(spec.before, spec.after, room.type);
      return <Halves before={<Glyphs value={spec.before} scale={s} />} after={<Glyphs value={spec.after} scale={s} />} />;
    }
    case 'image':
      return (
        <Halves
          before={<img className="bt-img" src={spec.before} alt="" loading="lazy" decoding="async" />}
          after={<img className="bt-img" src={spec.after} alt="" loading="lazy" decoding="async" />}
        />
      );
    case 'screen':
      // One screen, not a before/after: an exploration is a new screen. Its top shows, where the page starts.
      return spec.src ? <img className="bt-img bt-screen" src={spec.src} alt="" loading="lazy" decoding="async" /> : <ScreenSketch />;
    case 'text':
      return <Halves before={<Lines />} after={<Lines />} />;
    case 'icon':
      return <Icon icon={ICONS[spec.icon]} size={size === 'row' ? 'sm' : 'lg'} />;
  }
}

/** What the thumbnail shows, when it is one named thing (a build request's component): kept on the element for tests and tools. */
const label = (spec: ThumbSpec) => (spec.kind === 'image' || spec.kind === 'icon' ? spec.label : undefined);

export function BranchThumb({ spec, size }: { spec: ThumbSpec; size: 'row' | 'card' }) {
  return (
    <span className={`bt bt--${size} bt--${spec.kind}`} aria-hidden="true" data-label={label(spec)}>
      {body(spec, size)}
    </span>
  );
}
