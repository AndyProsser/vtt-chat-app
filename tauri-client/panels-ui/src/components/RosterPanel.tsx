import { Badge, Flex, ScrollArea, Text } from '@radix-ui/themes';
import { memo } from 'react';

import { useTableFeed } from '../hooks/useTableFeed.js';
import { useTableStore } from '../lib/tableStore.js';
import type { Member } from '../types/index.js';
import { Avatar } from './Avatar.js';
import { MuteIcon } from './MuteIcon.js';
import { usePanelBridge } from '../hooks/usePanelBridge.js';

const Row = memo(function Row({ member }: { member: Member }) {
  const label = member.character?.name ?? member.displayName;
  return (
    <Flex align="center" gap="2" py="1" style={{ opacity: member.online ? 1 : 0.5 }}>
      <Avatar participantId={member.userId} />
      <Text size="2" style={{ flex: 1 }}>
        {label}
        {member.character && (
          <Text color="gray" size="1">
            {' '}
            · {member.displayName}
          </Text>
        )}
      </Text>
      {member.role === 'dm' && (
        <Badge color="violet" size="1">
          DM
        </Badge>
      )}
      {member.online && member.inVoice && member.muted && (
        <Text size="1" color="gray">
          muted
        </Text>
      )}
    </Flex>
  );
});

export function RosterPanel() {
  usePanelBridge();
  useTableFeed();
  const members = useTableStore((s) => s.members);
  return (
    <Flex direction="column" gap="2" p="3" style={{ height: '100vh', boxSizing: 'border-box' }}>
      <Flex align="center" justify="between">
        <Text weight="bold">At the table</Text>
        <MuteIcon />
      </Flex>
      <ScrollArea>
        {members.length === 0 ? (
          <Text size="2" color="gray">
            Not connected to a campaign.
          </Text>
        ) : (
          members.map((m) => <Row key={m.userId} member={m} />)
        )}
      </ScrollArea>
    </Flex>
  );
}
