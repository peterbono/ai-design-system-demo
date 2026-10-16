// Icon-only link styled as a ghost DS Button. DS gap: IconButton has no `render` prop, so an icon link cannot be a
// square IconButton; this uses Button (ghost, iconStart, no label) with the accessible name in aria-label.
import type { AnchorHTMLAttributes } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@bridge-ds/react';
import type { LucideIcon } from 'lucide-react';

export interface IconLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'aria-label'> {
  href: string;
  icon: LucideIcon;
  /** Accessible name: say where the link goes. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function IconLink({ href, icon, label, variant = 'ghost', size = 'md', ...rest }: IconLinkProps) {
  return <Button variant={variant} size={size} iconStart={icon} aria-label={label} render={<a href={href} />} {...(rest as object)} />;
}
