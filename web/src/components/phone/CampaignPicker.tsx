import { Card, Flex, Heading, Text } from '@radix-ui/themes';

import type { CampaignItem } from '../../types/phone.js';
import { Icon } from '@vtt-chat-app/ui-kit';
import { DecisionBanner } from './DecisionBanner.js';
import { NextSessionRow } from './NextSessionRow.js';
import { OpenTables } from './OpenTables.js';

export function CampaignPicker({
  campaigns,
  onPick,
}: {
  campaigns: CampaignItem[];
  onPick: (id: string) => void;
}) {
  return (
    <Flex direction="column" gap="3" className="phone-pad">
      <DecisionBanner />
      <Heading size="6">Choose a table</Heading>
      {campaigns.length === 0 && (
        <>
          <Text color="gray">
            You are not in a campaign yet. Ask your DM for an invite link and open it on this
            device.
          </Text>
          <Heading size="4" as="h2">
            Or ask to join a table
          </Heading>
          <OpenTables />
        </>
      )}
      {campaigns.map((c) => (
        <div key={c.id} className="phone-picker-item">
          <Card asChild size="2">
            <button type="button" className="phone-card-button" onClick={() => onPick(c.id)}>
              <Flex align="center" gap="2">
                {c.role === 'dm' && (
                  <span className="phone-dm-crown" title="You are the DM">
                    <Icon name="crown" size={16} />
                    <span className="phone-visually-hidden">You are the DM</span>
                  </span>
                )}
                <Text size="4" weight="medium" className="phone-picker-name">
                  {c.name}
                </Text>
              </Flex>
            </button>
          </Card>
          <NextSessionRow campaignId={c.id} />
        </div>
      ))}
    </Flex>
  );
}
