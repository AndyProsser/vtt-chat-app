import { Tabs } from '@radix-ui/themes';

import { AccountSection } from './settings/AccountSection.js';
import { AppearanceSection } from './settings/AppearanceSection.js';
import { CampaignTab } from './settings/CampaignTab.js';
import { GeneralSection } from './settings/GeneralSection.js';
import { LinkedAccounts } from './settings/LinkedAccounts.js';
import { SessionsSection } from './settings/SessionsSection.js';

/** Everything done occasionally, in one window: you, the campaign and your character, sessions, and the app itself. */
export function SettingsWindow() {
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
          <AccountSection />
          <LinkedAccounts />
        </Tabs.Content>
        <Tabs.Content value="campaign">
          <CampaignTab />
        </Tabs.Content>
        <Tabs.Content value="sessions">
          <SessionsSection />
        </Tabs.Content>
        <Tabs.Content value="general">
          <AppearanceSection />
          <GeneralSection />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
