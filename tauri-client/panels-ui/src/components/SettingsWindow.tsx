import { Tabs } from '@radix-ui/themes';

import { useTableFeed } from '../hooks/useTableFeed.js';

import { AccountSection } from './settings/AccountSection.js';
import { AudioSection } from './settings/AudioSection.js';
import { AppearanceSection } from './settings/AppearanceSection.js';
import { CampaignTab } from './settings/CampaignTab.js';
import { GeneralSection } from './settings/GeneralSection.js';
import { NotificationsSection } from './settings/NotificationsSection.js';
import { StatusSetting } from './settings/StatusSetting.js';
import { SessionsSection } from './settings/SessionsSection.js';

/**
 * Everything done occasionally: you, the campaign and your character, sessions, and the app itself.
 * It reads the table store, which the main window keeps fed, so it holds no feed of its own.
 */
export function SettingsContent() {
  return (
    <div className="vtt-settings">
      <Tabs.Root defaultValue="profile">
        <Tabs.List>
          <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
          <Tabs.Trigger value="campaign">Campaign</Tabs.Trigger>
          <Tabs.Trigger value="sessions">Sessions</Tabs.Trigger>
          <Tabs.Trigger value="general">General</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="profile">
          <StatusSetting />
          <AccountSection />
        </Tabs.Content>
        <Tabs.Content value="campaign">
          <CampaignTab />
        </Tabs.Content>
        <Tabs.Content value="sessions">
          <SessionsSection />
        </Tabs.Content>
        <Tabs.Content value="general">
          <AppearanceSection />
          <AudioSection />
          <NotificationsSection />
          <GeneralSection />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

/** The same content as a window of its own (the tray's "Settings"), which has to feed the store itself. */
export function SettingsWindow() {
  useTableFeed();
  return <SettingsContent />;
}
