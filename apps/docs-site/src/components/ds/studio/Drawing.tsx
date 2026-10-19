// A Field Guide line drawing for React islands, the twin of components/Illustration.astro (same art, same .ill
// styles in styles/brand.css). Decorative: hidden from assistive tech.
import { ILLUSTRATIONS, type IllustrationName } from '../../../brand/illustrations';

/** `crop`: a tighter viewBox ("x y w h") when the drawing's own box has empty sky above the scene. */
export function Drawing({ name, width, className, crop }: { name: IllustrationName; width?: number; className?: string; crop?: string }) {
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
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: art.svg }}
    />
  );
}
