import { Badge, Card, Flex, Heading, Text } from '@radix-ui/themes';

import type { CampaignItem } from '../../types/phone.js';
import { DecisionBanner } from './DecisionBanner.js';
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
        <Card key={c.id} asChild size="2">
          <button type="button" className="phone-card-button" onClick={() => onPick(c.id)}>
            <Flex justify="between" align="center" gap="3">
              <Text size="4" weight="medium">
                {c.name}
              </Text>
              {c.role === 'dm' && <Badge color="violet">DM</Badge>}
            </Flex>
          </button>
        </Card>
      ))}
    </Flex>
  );
}
