// "Start a change" on the Studio Overview. A DS Menu with the same intents as "Change this component"
// (lib/change-intent.ts) plus a new component, one plain line under each:
//   - Adjust the look: Studio Tokens.
//   - Add a variant or option, Something looks wrong: pick the component in place, under the greeting (a DS
//     Combobox; inside a DS Dialog its list opens behind the dialog, the gap #90 found), then its Components drawer
//     opens on that intent (?c=<slug>&intent=<intent>, scripts/components-studio.ts).
//   - New component: Changes > Explorations with the start form open (?view=explorations&start=new).
// The page decides its weight (`bridge:start-change`): the primary when nothing needs the viewer, secondary when the
// first need is the primary, hidden signed out (Connect GitHub takes its place).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { Button, Combobox, Form, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@bridge-ds/react';
import { CHANGE_INTENTS, type ChangeIntent } from '../../../lib/change-intent';
import { startChangeHref } from '../../../lib/overview-board';

export interface StartChangeProps {
  components: { name: string; slug: string; family?: string }[];
}

export const START_CHANGE_EVENT = 'bridge:start-change';
/** Sent when the component picker opens or closes, so the page keeps one primary action (the picker's Continue). */
export const PICKER_EVENT = 'bridge:start-change-picker';

export interface StartChangeLook {
  variant: 'primary' | 'secondary';
  hidden: boolean;
}

const label = (v: ChangeIntent) => CHANGE_INTENTS.find((o) => o.value === v)!.label;

/** One line under each choice: what it leads to. */
const LINE = {
  look: 'Colors, radius, spacing and type, in the tokens.',
  variant: 'Claude builds it from your Figma frame.',
  new: 'Try it first in an exploration.',
  wrong: 'Report what does not match Figma.',
};

const PICK_COPY: Record<'variant' | 'wrong', string> = {
  variant: 'Which component gets the new option? Its page opens on the steps, Claude builds it from your Figma frame.',
  wrong: 'Which component looks wrong? Its page opens on the steps to report what does not match Figma.',
};

function Item({ title, line }: { title: string; line: string }) {
  return (
    <span className="ov-mi">
      <span className="ov-mi-title">{title}</span>
      <span className="t-muted">{line}</span>
    </span>
  );
}

function pageLook(): StartChangeLook {
  const d = document.querySelector<HTMLElement>('[data-greet]')?.dataset;
  return { variant: d?.startVariant === 'secondary' ? 'secondary' : 'primary', hidden: d?.startHidden === 'true' };
}

export default function StartChange({ components }: StartChangeProps) {
  // The server render and the first client render agree; the page's choice comes in right after.
  const [look, setLook] = useState<StartChangeLook>({ variant: 'primary', hidden: false });
  const [pick, setPick] = useState<'variant' | 'wrong' | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const go = (href: string) => {
    location.href = href;
  };

  useEffect(() => {
    const on = (e: Event) => setLook((e as CustomEvent<StartChangeLook>).detail);
    document.addEventListener(START_CHANGE_EVENT, on);
    setLook(pageLook());
    setSlot(document.querySelector<HTMLElement>('[data-pick-slot]'));
    return () => document.removeEventListener(START_CHANGE_EVENT, on);
  }, []);

  useEffect(() => {
    if (!slot) return;
    slot.hidden = !pick;
    document.dispatchEvent(new CustomEvent(PICKER_EVENT, { detail: { open: Boolean(pick) } }));
    if (pick) requestAnimationFrame(() => field.current?.focus());
  }, [pick, slot]);

  const open = (v: 'variant' | 'wrong') => {
    setSlug(null);
    setPick(v);
  };
  const cancel = () => {
    setPick(null);
    setSlug(null);
    document.querySelector<HTMLElement>('[data-start-change]')?.focus();
  };

  if (look.hidden) return null;
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button variant={look.variant} iconEnd={ChevronDown} fullWidth data-start-change>
              Start a change
            </Button>
          }
        />
        <MenuContent align="end">
          <MenuItem label={label('look')} onClick={() => go(startChangeHref('look'))}>
            <Item title={label('look')} line={LINE.look} />
          </MenuItem>
          <MenuItem label={label('variant')} onClick={() => open('variant')}>
            <Item title={label('variant')} line={LINE.variant} />
          </MenuItem>
          <MenuItem label="New component" onClick={() => go(startChangeHref('new'))}>
            <Item title="New component" line={LINE.new} />
          </MenuItem>
          <MenuSeparator />
          <MenuItem label={label('wrong')} onClick={() => open('wrong')}>
            <Item title={label('wrong')} line={LINE.wrong} />
          </MenuItem>
        </MenuContent>
      </Menu>
      {pick &&
        slot &&
        createPortal(
          <Form
            className="ov-pick"
            aria-label={label(pick)}
            onFormSubmit={() => {
              if (slug) go(startChangeHref(pick, slug));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.defaultPrevented) cancel();
            }}
          >
            <p className="t-body ov-pick-line">
              <b>{label(pick)}.</b> {PICK_COPY[pick]}
            </p>
            <div className="ov-pick-row">
              <div className="ov-pick-field">
                <Combobox
                  ref={field}
                  label="Component"
                  placeholder="Type a name, for example Button"
                  options={components.map((c) => ({ value: c.slug, label: c.name }))}
                  value={slug}
                  onValueChange={(v) => setSlug(typeof v === 'string' ? v : null)}
                />
              </div>
              <span className="ov-pick-actions">
                <Button variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={!slug}>
                  Continue
                </Button>
              </span>
            </div>
          </Form>,
          slot,
        )}
    </>
  );
}
