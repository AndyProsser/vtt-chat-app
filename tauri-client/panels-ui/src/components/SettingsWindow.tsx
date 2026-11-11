import { Tabs } from '@radix-ui/themes';

import { useJoinFeed } from '../hooks/useJoinFeed.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { pendingCount } from '../lib/joinRequests.js';
import { useJoinStore } from '../lib/joinStore.js';
import { normalizeSettingsTab, SETTINGS_TABS } from '../lib/settingsTabs.js';

import { AccountSection } from './settings/AccountSection.js';
import { AppearanceSection } from './settings/AppearanceSection.js';
import { AppSection } from './settings/AppSection.js';
import { AudioSection } from './settings/AudioSection.js';
import { CampaignTab } from './settings/CampaignTab.js';
import { NotificationsSection } from './settings/NotificationsSection.js';
import { SessionsSection } from './settings/SessionsSection.js';
import { StatusSetting } from './settings/StatusSetting.js';

/**
 * Everything done occasionally: you (and the app itself, at the bottom of Profile), the campaign and
 * your character, sessions, audio, and notifications. It reads the table store, which the main window
 * keeps fed, so it holds no feed of its own. `initialTab` accepts old tab ids (`general` is `audio`).
 */
export function SettingsContent({ initialTab }: { initialTab?: string }) {
  const waiting = useJoinStore((s) => pendingCount(s.inbox));
  return (
    <div className="vtt-settings">
      <Tabs.Root defaultValue={normalizeSettingsTab(initialTab)}>
        <Tabs.List>
          {SETTINGS_TABS.map((t) => (
            <Tabs.Trigger key={t.id} value={t.id}>
              {t.label}
              {t.id === 'campaign' && waiting > 0 && (
                <span className="vtt-tab-badge" aria-label={`${waiting} join requests waiting`}>
                  {waiting}
                </span>
              )}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="profile">
          <div className="vtt-settings-page">
            <AccountSection />
            <StatusSetting />
            <AppearanceSection />
            <AppSection />
          </div>
        </Tabs.Content>
        <Tabs.Content value="campaign">
          <div className="vtt-settings-page">
            <CampaignTab />
          </div>
        </Tabs.Content>
        <Tabs.Content value="sessions">
          <div className="vtt-settings-page">
            <SessionsSection />
          </div>
        </Tabs.Content>
        <Tabs.Content value="audio">
          <div className="vtt-settings-page">
            <AudioSection />
          </div>
        </Tabs.Content>
        <Tabs.Content value="notifications">
          <div className="vtt-settings-page">
            <NotificationsSection />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

/** The same content as a window of its own (the tray's "Settings"), which has to feed the store itself. */
export function SettingsWindow() {
  useTableFeed();
  useJoinFeed();
  return <SettingsContent />;
}
