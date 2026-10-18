// "Start a change", the one primary action of the Studio Overview. A DS Menu with the same intents as "Change this
// component" (lib/change-intent.ts) plus a new component:
//   - Adjust the look: Studio Tokens.
//   - Add a variant or option, Something looks wrong: pick the component in a DS Dialog, then its Components drawer
//     opens on that intent (?c=<slug>&intent=<intent>, scripts/components-studio.ts).
//   - New component: Changes > Explorations with the start form open (?view=explorations&start=new).
import { useState } from 'react';
import { Box, ChevronDown, Palette, SquarePlus, TriangleAlert } from 'lucide-react';
import { Button, Combobox, Dialog, DialogClose, DialogContent, Menu, MenuContent, MenuItem, MenuTrigger } from '@bridge-ds/react';
import { CHANGE_INTENTS, type ChangeIntent } from '../../../lib/change-intent';
import { startChangeHref } from '../../../lib/overview-board';

export interface StartChangeProps {
  components: { name: string; slug: string; family?: string }[];
}

const label = (v: ChangeIntent) => CHANGE_INTENTS.find((o) => o.value === v)!.label;

/** Picks the component for an intent that needs one. */
const PICK_COPY: Record<'variant' | 'wrong', { description: string; go: string }> = {
  variant: { description: 'Pick the component. Its page opens on the steps: describe the option, Claude builds it from your Figma frame.', go: 'Continue' },
  wrong: { description: 'Pick the component. Its page opens on the steps to report what does not match Figma.', go: 'Continue' },
};

export default function StartChange({ components }: StartChangeProps) {
  const [pick, setPick] = useState<'variant' | 'wrong' | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState('');
  const go = (href: string) => {
    location.href = href;
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button variant="primary" iconEnd={ChevronDown} fullWidth data-start-change>
              Start a change
            </Button>
          }
        />
        <MenuContent align="end">
          <MenuItem icon={Palette} onClick={() => go(startChangeHref('look'))}>
            {label('look')}
          </MenuItem>
          <MenuItem icon={SquarePlus} onClick={() => setPick('variant')}>
            {label('variant')}
          </MenuItem>
          <MenuItem icon={TriangleAlert} onClick={() => setPick('wrong')}>
            {label('wrong')}
          </MenuItem>
          <MenuItem icon={Box} onClick={() => go(startChangeHref('new'))}>
            New component
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog
        open={pick !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPick(null);
          setSlug(null);
          setError('');
        }}
      >
        {pick && (
          <DialogContent
            title={label(pick)}
            description={PICK_COPY[pick].description}
            size="sm"
            hideClose
            footer={
              <>
                <DialogClose render={<Button variant="secondary">Cancel</Button>} />
                <Button
                  variant="primary"
                  onClick={() => {
                    if (!slug) return setError('Pick a component from the list, for example Button.');
                    go(startChangeHref(pick, slug));
                  }}
                >
                  {PICK_COPY[pick].go}
                </Button>
              </>
            }
          >
            <Combobox
              label="Component"
              placeholder="Search components"
              options={components.map((c) => ({ value: c.slug, label: c.name, ...(c.family ? { description: c.family } : {}) }))}
              value={slug}
              onValueChange={(v) => {
                setSlug(typeof v === 'string' ? v : null);
                setError('');
              }}
              error={error || undefined}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
