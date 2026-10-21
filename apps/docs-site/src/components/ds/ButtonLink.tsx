// A link that looks like a DS Button (Button with render={<a />}), usable from .astro files, which cannot build the
// render element in frontmatter. Rendered statically: no client JS. Extra attributes (id, data-*, aria-*, target,
// rel, title) land on the <a>.
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@bridge-ds/react';
import type { LucideIcon } from 'lucide-react';

export interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconStart?: LucideIcon;
  iconEnd?: LucideIcon;
  /** Fill the width of the container (Button fullWidth). */
  fullWidth?: boolean;
  children?: ReactNode;
}

export default function ButtonLink({ href, variant = 'secondary', size = 'md', iconStart, iconEnd, fullWidth, children, ...rest }: ButtonLinkProps) {
  return (
    <Button variant={variant} size={size} iconStart={iconStart} iconEnd={iconEnd} fullWidth={fullWidth} render={<a href={href} />} {...(rest as object)}>
      {children}
    </Button>
  );
}
