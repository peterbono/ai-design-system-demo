// The changes of this screen, in the bar: the count (it also turns the outlines on and off), Previous and Next, and
// Isolate. Shown for token changes only; Previous, Next and Isolate only once there is a change to step through.
import { Button, ButtonGroup, IconButton, Tooltip, VisuallyHidden } from '@bridge-ds/react';
import { ChevronLeft, ChevronRight, ScanSearch } from 'lucide-react';
import { PIN_CLASS } from './pin';
import styles from './BridgeToolbar.module.css';

export interface ChangeNavProps {
  /** "Show what changed", "3 changes", "Change 2 of 3", "No changes here". */
  countText: string;
  /** The count's tooltip: what changed and the C shortcut. */
  tip: string;
  outlinesOn: boolean;
  /** The change shows nothing in this theme or brand: the count is muted. */
  disabled: boolean;
  /** Changes to step through, null while outlines are off or measuring. */
  total: number | null;
  isolate: boolean;
  /** Said to screen readers on each step: "Change 2 of 3: Save bar". */
  announce: string;
  onToggle: () => void;
  onStep: (delta: 1 | -1) => void;
  onIsolate: (on: boolean) => void;
}

export function ChangeNav({ countText, tip, outlinesOn, disabled, total, isolate, announce, onToggle, onStep, onIsolate }: ChangeNavProps) {
  return (
    <div className={styles.nav} role="group" aria-label="Changes on this screen">
      <Tooltip className={PIN_CLASS} content={tip}>
        <Button variant="secondary" size="md" iconStart={ScanSearch} pressed={outlinesOn} aria-keyshortcuts="C" disabled={disabled} onClick={onToggle} className={styles.countButton}>
          {countText}
        </Button>
      </Tooltip>
      {total ? (
        <>
          <ButtonGroup appearance="attached" aria-label="Step through the changes" className={styles.steps}>
            <Tooltip className={PIN_CLASS} content="Previous change">
              <IconButton icon={ChevronLeft} variant="secondary" size="md" label="Previous change" onClick={() => onStep(-1)} />
            </Tooltip>
            <Tooltip className={PIN_CLASS} content="Next change">
              <IconButton icon={ChevronRight} variant="secondary" size="md" label="Next change" onClick={() => onStep(1)} />
            </Tooltip>
          </ButtonGroup>
          <Tooltip className={PIN_CLASS} content={isolate ? 'Show the whole page again. Press Esc.' : 'Dim everything but the changes. Esc turns it off.'}>
            <Button variant="secondary" size="md" pressed={isolate} aria-keyshortcuts={isolate ? 'Escape' : undefined} onClick={() => onIsolate(!isolate)}>
              Isolate
            </Button>
          </Tooltip>
        </>
      ) : null}
      <VisuallyHidden role="status">{announce}</VisuallyHidden>
    </div>
  );
}
