import { Tabs } from '@radix-ui/themes';
import { historyTabs, type HistoryTabId } from '@vtt-chat-app/shared';
import { Maximize2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

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
  transcript,
}: {
  summaries: SummaryView[];
  initialTab?: HistoryTabId;
  onTabChange?: (tab: HistoryTabId) => void;
  onPopout?: () => void;
  /** The Game Master's raw transcript, as one more tab at the end; its content mounts only when the tab is opened. */
  transcript?: ReactNode;
}) {
  const tabs = historyTabs(summaries);
  const TRANSCRIPT = 'transcript';
  const [chosen, setChosen] = useState<string | undefined>(initialTab);
  if (tabs.length === 0 && !transcript) return null;
  // A tab that is not there (a player asked to open on The Notes) falls back to the first one.
  const value =
    (transcript && chosen === TRANSCRIPT) || tabs.some((t) => t.id === chosen)
      ? chosen
      : (tabs[0]?.id ?? TRANSCRIPT);
  return (
    <Tabs.Root
      value={value}
      onValueChange={(id) => {
        setChosen(id as HistoryTabId);
        // The transcript has no window of its own: the pop-out keeps opening on the last real tab.
        if (id !== TRANSCRIPT) onTabChange?.(id as HistoryTabId);
      }}
    >
      <div className="vtt-session-tabs">
        <Tabs.List size="1">
          {tabs.map((t) => (
            <Tabs.Trigger key={t.id} value={t.id}>
              {t.label}
            </Tabs.Trigger>
          ))}
          {transcript && <Tabs.Trigger value={TRANSCRIPT}>Transcript</Tabs.Trigger>}
        </Tabs.List>
        {onPopout && (
          <ToolButton label="Open in its own window" square onClick={onPopout}>
            <Maximize2 size={14} />
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
      {transcript && <Tabs.Content value={TRANSCRIPT}>{transcript}</Tabs.Content>}
    </Tabs.Root>
  );
}
