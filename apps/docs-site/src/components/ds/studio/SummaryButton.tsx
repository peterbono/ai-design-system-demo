// The <summary> of a native <details> menu, styled as a DS Button. The details element keeps the open/close
// behavior (and the vanilla scripts that read it); only the trigger's look comes from the design system.
import { Button, type ButtonProps } from '@bridge-ds/react';

export default function SummaryButton(props: Omit<ButtonProps, 'render' | 'type'>) {
  return <Button {...props} render={<summary />} />;
}
