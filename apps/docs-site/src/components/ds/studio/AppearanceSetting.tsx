// Settings, Appearance: light, dark or the system setting (lib/theme-pref.ts). A preference of this browser, for
// everyone (guests, the sample team, the browser workspace, every team), never a team rule: nothing goes to GitHub.
// The same card on the self-hosted Settings (pages/studio/settings) and on a team's Settings (pages/team-shell/settings).
import { useEffect, useState } from 'react';
import { Card, CardBody, SegmentedControl } from '@bridge-ds/react';
import { parseThemePref, readThemePref, setThemePref, THEME_PREFS, type ThemePref } from '../../../lib/theme-pref';

export default function AppearanceSetting() {
  // System until the browser says otherwise: the server render does not know this browser's choice.
  const [pref, setPref] = useState<ThemePref>('system');
  useEffect(() => {
    setPref(readThemePref());
    // A pick made in another tab (scripts/shell.ts relays it).
    const onPref = (e: Event) => setPref(parseThemePref((e as CustomEvent<string>).detail));
    document.addEventListener('bridge:theme-pref', onPref);
    return () => document.removeEventListener('bridge:theme-pref', onPref);
  }, []);
  const pick = (value: string) => {
    const next = parseThemePref(value === 'system' ? null : value);
    setPref(next);
    setThemePref(next);
  };
  return (
    <Card>
      <CardBody>
        <div className="set-rows">
          <div className="set-row">
            <div>
              <p className="set-row-label" id="set-theme-label">
                Theme
              </p>
              <p className="set-row-help">System follows the light or dark setting of your computer.</p>
            </div>
            <div className="set-row-value">
              <SegmentedControl aria-labelledby="set-theme-label" value={pref} onValueChange={pick} items={THEME_PREFS} data-theme-pref />
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
