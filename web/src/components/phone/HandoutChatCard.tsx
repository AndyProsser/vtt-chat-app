import { Badge, Card, Flex, Text } from '@radix-ui/themes';

import { plainPreview } from '@vtt-chat-app/shared';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import type { HandoutItem } from '../../types/phone.js';
import { Icon } from '@vtt-chat-app/ui-kit';

const KIND_LABEL = { text: 'Note', image: 'Pictures', map: 'Map', pdf: 'PDF' } as const;

/**
 * A shared handout in the chat: its title, what kind it is, and the start of a note. Tapping it opens the
 * whole handout (the same screen as in the Handouts tab); Back returns here.
 */
export function HandoutChatCard({ item }: { item: HandoutItem }) {
  const openHandout = usePhoneStore((s) => s.openHandout);
  return (
    <Card asChild size="1" className="phone-loot-card phone-handout-card">
      <button type="button" className="phone-card-button" onClick={() => openHandout(item.id)}>
        <Flex direction="column" gap="1">
          <Flex gap="2" align="center" justify="between">
            <Flex gap="2" align="center" style={{ minWidth: 0 }}>
              <Icon name="handouts" size={16} />
              <Text weight="medium" size="2">
                {item.title}
              </Text>
            </Flex>
            <Badge color="gray" size="1" style={{ flex: 'none' }}>
              {KIND_LABEL[item.kind]}
            </Badge>
          </Flex>
          {item.kind === 'text' && item.body && (
            <Text size="1" color="gray" className="phone-clamp">
              {plainPreview(item.body)}
            </Text>
          )}
        </Flex>
      </button>
    </Card>
  );
}
