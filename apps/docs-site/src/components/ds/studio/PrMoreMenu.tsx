// The "More" menu of a change (Changes > a pull request): the rare actions that stay out of the action bar. The
// owner override, with its rule in one sentence, and closing the change. DS Menu, mounted by scripts/reviews.ts
// into the server-rendered action bar.
import { createRoot, type Root } from 'react-dom/client';
import { Button, Menu, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from '@bridge-ds/react';

export interface PrMoreMenuProps {
  /** Shown when the viewer may ship past missing approvals (mergeGate overridable). */
  override?: { rule: string; onSelect: () => void } | null;
  /** Shown to anyone with write access while the change is open. */
  onClose?: (() => void) | null;
}

export function PrMoreMenu({ override, onClose }: PrMoreMenuProps) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="secondary">More</Button>} />
      <MenuContent side="top" align="end">
        {override && (
          <MenuGroup label={override.rule}>
            <MenuItem onClick={override.onSelect}>Ship as owner override</MenuItem>
          </MenuGroup>
        )}
        {override && onClose && <MenuSeparator />}
        {onClose && (
          <MenuItem tone="danger" onClick={onClose}>
            Close without shipping
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

/** Renders the menu into `el`; call `unmount()` on the result before the detail is repainted. */
export function mountPrMoreMenu(el: HTMLElement, props: PrMoreMenuProps): Root {
  const root = createRoot(el);
  root.render(<PrMoreMenu {...props} />);
  return root;
}
