import { Badge, Card, Flex, Tabs, Text } from '@radix-ui/themes';
import { historyTabs, splitTaleTitle, type HistoryTabId } from '@vtt-chat-app/shared';
import { useState } from 'react';

import { summaryTitle } from '../../lib/phone/format.js';
import type { SummaryItem } from '../../types/phone.js';
import { LazyMarkdown } from './LazyMarkdown.js';

function SummaryCard({ s }: { s: SummaryItem }) {
  // The storyteller titles the tale on its first line: that is its heading here.
  const tale = s.kind === 'session' ? splitTaleTitle(s.text) : { title: null, body: s.text };
  return (
    <Card size="2">
      <Flex direction="column" gap="2">
        <Flex gap="2" align="center">
          <Text size="2" weight="medium">
            {tale.title ?? summaryTitle(s.kind)}
            {tale.title ? ` · ${summaryTitle(s.kind)}` : ''}
            {s.subject ? `: ${s.subject}` : ''}
            {s.title ? ` · ${s.title}` : ''}
          </Text>
          {s.visibility !== 'members' && <Badge color="violet">DM only</Badge>}
        </Flex>
        <LazyMarkdown text={tale.body} />
      </Flex>
    </Card>
  );
}

/**
 * A recorded session as tabs, one part at a time: The Tale, The Heroes, The Story and, for the Game Master, The Notes
 * (the brief, then the scribe's notes). The same parts as the desktop app's History.
 */
export function SessionTabs({ summaries }: { summaries: SummaryItem[] }) {
  const tabs = historyTabs(summaries);
  const [chosen, setChosen] = useState<HistoryTabId>();
  if (tabs.length === 0) return null;
  const value = tabs.some((t) => t.id === chosen) ? chosen : tabs[0]!.id;
  return (
    <Tabs.Root value={value} onValueChange={(id) => setChosen(id as HistoryTabId)}>
      <Tabs.List size="1" className="phone-session-tabs">
        {tabs.map((t) => (
          <Tabs.Trigger key={t.id} value={t.id}>
            {t.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((t) => (
        <Tabs.Content key={t.id} value={t.id}>
          <Flex direction="column" gap="3" pt="3">
            {t.items.map((s, i) => (
              <SummaryCard key={`${t.id}:${s.subject ?? ''}:${i}`} s={s} />
            ))}
          </Flex>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
