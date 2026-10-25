// Settings, Appearance: Light or Dark (lib/theme-pref.ts). A preference of this browser, for everyone (guests, the
// sample team, the browser workspace, every team), never a team rule: nothing goes to GitHub. Before any pick the page
// takes the OS setting, and the control shows that theme selected. The same card on the self-hosted Settings
// (pages/studio/settings) and on a team's Settings (pages/team-shell/settings).
import { useEffect, useState } from 'react';
import { Card, CardBody, SegmentedControl } from '@bridge-ds/react';
import { effectiveTheme, setThemePref, THEME_OPTIONS, type Theme } from '../../../lib/theme-pref';

export default function AppearanceSetting() {
  // Light until the browser says otherwise: the server render does not know this browser's theme.
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    setTheme(effectiveTheme());
    // A pick made in another tab, or the OS switching before any pick (scripts/shell.ts relays both).
    const sync = () => setTheme(effectiveTheme());
    document.addEventListener('bridge:theme', sync);
    document.addEventListener('bridge:theme-pref', sync);
    return () => {
      document.removeEventListener('bridge:theme', sync);
      document.removeEventListener('bridge:theme-pref', sync);
    };
  }, []);
  const pick = (value: string) => {
    if (value !== 'light' && value !== 'dark') return;
    setTheme(value);
    setThemePref(value);
  };
  return (
    <Card>
      <CardBody>
        <div className="set-rows">
          <div className="set-row">
            <p className="set-row-label" id="set-theme-label">
              Theme
            </p>
            <div className="set-row-value">
              <SegmentedControl aria-labelledby="set-theme-label" value={theme} onValueChange={pick} items={THEME_OPTIONS} data-theme-pref />
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
