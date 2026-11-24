import { Switch } from '@radix-ui/themes';
import { READING_SWITCHES, useReadingPrefs } from '@vtt-chat-app/ui-kit';

import { SettingRow } from './SettingRow.js';

/** The three reading switches, in Appearance. They apply at once, in every window, and are kept on this device. */
export function ReadingSwitches() {
  const prefs = useReadingPrefs();
  return (
    <>
      {READING_SWITCHES.map((s) => (
        <SettingRow key={s.key} label={s.label} hint={s.hint}>
          <Switch
            checked={prefs[s.key]}
            onCheckedChange={(on) => prefs.set({ [s.key]: on })}
            aria-label={s.label}
          />
        </SettingRow>
      ))}
    </>
  );
}
