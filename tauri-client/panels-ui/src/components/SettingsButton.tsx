import { Popover } from '@radix-ui/themes';
import { Settings } from 'lucide-react';

import { pendingCount } from '../lib/joinRequests.js';
import { useJoinStore } from '../lib/joinStore.js';
import { SettingsContent } from './SettingsWindow.js';
import { ToolButton } from './ToolButton.js';

/**
 * The cog at the right of the top bar: drops the Settings panel down from the bar (profile, campaign, sessions,
 * audio, notifications, and the DM's connection quality). A dot shows when join requests are waiting. There is no
 * Quit here: the app is meant to run all the time, and quitting is the tray icon's job.
 */
export function SettingsButton() {
  const waiting = useJoinStore((s) => pendingCount(s.inbox));
  return (
    <Popover.Root>
      <Popover.Trigger>
        <ToolButton
          label={
            waiting > 0
              ? `Settings (${waiting} join request${waiting === 1 ? '' : 's'})`
              : 'Settings'
          }
          className="vtt-cog"
        >
          <Settings size={15} />
          {waiting > 0 && <span className="vtt-cog-dot" aria-hidden />}
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content
        size="1"
        align="end"
        className="vtt-settings-pop"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SettingsContent />
      </Popover.Content>
    </Popover.Root>
  );
}
