import { Tabs } from '@radix-ui/themes';
import { historyTabs, type HistoryTabId } from '@vtt-chat-app/shared';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';

import type { SummaryView } from '../lib/history.js';
import { SummaryCard } from './SummaryCard.js';
import { ToolButton } from './ToolButton.js';

/**
 * A recorded session as tabs, one part at a time: The Tale, The Heroes, The Story and, for the Game Master, The Notes
 * (the brief, then the scribe's notes). `onPopout` adds a button that opens the same view in its own window.
 */
export function SessionTabs({
  summaries,
  initialTab,
  onTabChange,
  onPopout,
}: {
  summaries: SummaryView[];
  initialTab?: HistoryTabId;
  onTabChange?: (tab: HistoryTabId) => void;
  onPopout?: () => void;
}) {
  const tabs = historyTabs(summaries);
  const [chosen, setChosen] = useState<HistoryTabId | undefined>(initialTab);
  if (tabs.length === 0) return null;
  // A tab that is not there (a player asked to open on The Notes) falls back to the first one.
  const value = tabs.some((t) => t.id === chosen) ? chosen : tabs[0]!.id;
  return (
    <Tabs.Root
      value={value}
      onValueChange={(id) => {
        setChosen(id as HistoryTabId);
        onTabChange?.(id as HistoryTabId);
      }}
    >
      <div className="vtt-session-tabs">
        <Tabs.List size="1">
          {tabs.map((t) => (
            <Tabs.Trigger key={t.id} value={t.id}>
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {onPopout && (
          <ToolButton label="Open in its own window" square onClick={onPopout}>
            <ExternalLink size={14} />
          </ToolButton>
        )}
      </div>
      {tabs.map((t) => (
        <Tabs.Content key={t.id} value={t.id}>
          <div className="vtt-sessions">
            {t.items.map((s, i) => (
              <SummaryCard key={`${t.id}${i}`} s={s} />
            ))}
          </div>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
