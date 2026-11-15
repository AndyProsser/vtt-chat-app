import { Flex, Heading, Text } from '@radix-ui/themes';

import type { InvitePreview } from '../types/index.js';
import { LazyMarkdown } from './phone/LazyMarkdown.js';

const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;

/**
 * What someone is being invited to: the campaign's name, who runs it, how many are in, and the DM's own
 * description. Each line is left out when there is nothing to say. The description is markdown shown as
 * structure only (raw HTML dropped, no pictures, links as text), like every other note.
 */
export function CampaignCard({ invite }: { invite: InvitePreview }) {
  const facts = [
    invite.dmName ? `Run by ${invite.dmName}` : undefined,
    invite.playerCount > 0 ? players(invite.playerCount) : undefined,
  ].filter((f): f is string => f !== undefined);
  return (
    <Flex direction="column" gap="2">
      <Text color="gray" size="2">
        You’ve been invited to
      </Text>
      <Heading size="6">{invite.campaignName}</Heading>
      {facts.length > 0 && (
        <Text color="gray" size="2">
          {facts.join(' · ')}
        </Text>
      )}
      {invite.description && (
        <Flex direction="column" gap="1" mt="2">
          <Text size="2" weight="bold">
            About this campaign
          </Text>
          <LazyMarkdown text={invite.description} />
        </Flex>
      )}
    </Flex>
  );
}
