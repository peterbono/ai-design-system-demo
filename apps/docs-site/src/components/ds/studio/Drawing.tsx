// A Field Guide line drawing for React islands, the twin of components/Illustration.astro (same art, same .ill
// styles in styles/brand.css). Decorative unless `label` is given.
import { ILLUSTRATIONS, type IllustrationName } from '../../../brand/illustrations';

/** `crop`: a tighter viewBox ("x y w h") when the drawing's own box has empty sky above the scene. */
export function Drawing({ name, width, className, crop, label }: { name: IllustrationName; width?: number; className?: string; crop?: string; label?: string }) {
  // Constant SVG from brand/illustrations.ts only: never inline SVG read from a repository (use <img src> for that).
  const art = ILLUSTRATIONS[name];
  const box = crop ?? art.viewBox;
  const [, , bw, bh] = box.split(' ').map(Number);
  const w = width ?? art.width;
  const h = Math.round((w * bh!) / bw!);
  return (
    <svg
      className={className ? `ill ${className}` : 'ill'}
      width={w}
      height={h}
      viewBox={box}
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: art.svg }}
    />
  );
}
