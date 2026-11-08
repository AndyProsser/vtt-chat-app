import { Tabs } from '@radix-ui/themes';

import { AccountSection } from './settings/AccountSection.js';
import { AppearanceSection } from './settings/AppearanceSection.js';
import { CharacterSection } from './settings/CharacterSection.js';
import { CampaignSection } from './settings/CampaignSection.js';
import { GeneralSection } from './settings/GeneralSection.js';
import { SessionsSection } from './settings/SessionsSection.js';

/** Everything done occasionally, in one window: account, the session schedule, and the look. */
export function SettingsWindow() {
  return (
    <div className="vtt-settings">
      <Tabs.Root defaultValue="account">
        <Tabs.List>
          <Tabs.Trigger value="account">Account</Tabs.Trigger>
          <Tabs.Trigger value="character">Character</Tabs.Trigger>
          <Tabs.Trigger value="campaign">Campaign</Tabs.Trigger>
          <Tabs.Trigger value="sessions">Sessions</Tabs.Trigger>
          <Tabs.Trigger value="appearance">Appearance</Tabs.Trigger>
          <Tabs.Trigger value="general">General</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="account">
          <AccountSection />
        </Tabs.Content>
        <Tabs.Content value="character">
          <CharacterSection />
        </Tabs.Content>
        <Tabs.Content value="campaign">
          <CampaignSection />
        </Tabs.Content>
        <Tabs.Content value="sessions">
          <SessionsSection />
        </Tabs.Content>
        <Tabs.Content value="appearance">
          <AppearanceSection />
        </Tabs.Content>
        <Tabs.Content value="general">
          <GeneralSection />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
