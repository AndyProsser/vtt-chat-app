import { Popover } from '@radix-ui/themes';
import { AudioLines, Backpack, FileText, ScrollText, Settings } from 'lucide-react';

import { panelOpen } from '../lib/tauriBridge.js';
import { CampaignSwitcher } from './CampaignSwitcher.js';
import { GroupsMenu } from './GroupsMenu.js';
import { RecordingIndicator } from './RecordingIndicator.js';
import { SettingsContent } from './SettingsWindow.js';
import { StatusMenu } from './StatusMenu.js';
import { ToolButton } from './ToolButton.js';

interface Props {
  dm: boolean;
  /** The DM's effects drawer. */
  effectsOpen: boolean;
  onToggleEffects: () => void;
}

/** Record state and timer on the left; on the right, icon buttons (with tip text) for the rest. */
export function TopBar({ dm, effectsOpen, onToggleEffects }: Props) {
  return (
    <header className="vtt-top">
      <CampaignSwitcher />
      <RecordingIndicator dm={dm} />
      <span className="vtt-spacer" />
      {dm && <GroupsMenu />}
      {dm && (
        <ToolButton
          label="Sound effects and voices"
          pressed={effectsOpen}
          onClick={onToggleEffects}
        >
          <AudioLines size={15} />
        </ToolButton>
      )}
      <ToolButton label="Handouts" onClick={() => void panelOpen('handouts')}>
        <FileText size={15} />
      </ToolButton>
      <ToolButton label="Session history" onClick={() => void panelOpen('history')}>
        <ScrollText size={15} />
      </ToolButton>
      <ToolButton label="Party inventory" onClick={() => void panelOpen('inventory')}>
        <Backpack size={15} />
      </ToolButton>
      <Popover.Root>
        <Popover.Trigger>
          <ToolButton label="Settings">
            <Settings size={15} />
          </ToolButton>
        </Popover.Trigger>
        <Popover.Content size="1" align="end" className="vtt-settings-pop">
          <SettingsContent />
        </Popover.Content>
      </Popover.Root>
      <StatusMenu />
    </header>
  );
}
