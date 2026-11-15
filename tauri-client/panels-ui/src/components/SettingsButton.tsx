import { Settings } from 'lucide-react';

import { pendingCount } from '../lib/joinRequests.js';
import { useJoinStore } from '../lib/joinStore.js';
import { panelOpen } from '../lib/tauriBridge.js';
import { ToolButton } from './ToolButton.js';

/**
 * The cog at the right of the top bar: opens the Settings window (profile, campaign, sessions, audio, notifications,
 * and the DM's connection quality). A dot shows when join requests are waiting. There is no Quit here: the app is
 * meant to run all the time, and quitting is the tray icon's job.
 */
export function SettingsButton() {
  const waiting = useJoinStore((s) => pendingCount(s.inbox));
  return (
    <ToolButton
      label={
        waiting > 0 ? `Settings (${waiting} join request${waiting === 1 ? '' : 's'})` : 'Settings'
      }
      className="vtt-cog"
      onClick={() => void panelOpen('settings')}
    >
      <Settings size={15} />
      {waiting > 0 && <span className="vtt-cog-dot" aria-hidden />}
    </ToolButton>
  );
}
