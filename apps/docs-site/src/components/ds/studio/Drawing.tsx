// A Field Guide line drawing for React islands, the twin of components/Illustration.astro (same art, same .ill
// styles in styles/brand.css). Decorative: hidden from assistive tech.
import { ILLUSTRATIONS, type IllustrationName } from '../../../brand/illustrations';

export function Drawing({ name, width, className }: { name: IllustrationName; width?: number; className?: string }) {
  const art = ILLUSTRATIONS[name];
  const w = width ?? art.width;
  const h = Math.round((w * art.height) / art.width);
  return (
    <svg
      className={className ? `ill ${className}` : 'ill'}
      width={w}
      height={h}
      viewBox={art.viewBox}
      fill="none"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: art.svg }}
    />
  );
}
