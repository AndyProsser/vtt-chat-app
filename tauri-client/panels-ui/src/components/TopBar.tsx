import { AudioLines, Backpack, FileText, NotebookPen, ScrollText } from 'lucide-react';

import { useSoundActivity } from '../hooks/useSoundActivity.js';
import { useUnconfirmed } from '../hooks/useUnconfirmed.js';
import { panelOpen } from '../lib/tauriBridge.js';
import { CampaignSwitcher } from './CampaignSwitcher.js';
import { GroupsMenu } from './GroupsMenu.js';
import { RecordingIndicator } from './RecordingIndicator.js';
import { SettingsButton } from './SettingsButton.js';
import { ToolButton } from './ToolButton.js';

interface Props {
  dm: boolean;
  /** The DM's effects drawer. */
  effectsOpen: boolean;
  onToggleEffects: () => void;
}

/** Record state and timer on the left; on the right, the table tools as icon buttons and a burger menu for the rest. */
export function TopBar({ dm, effectsOpen, onToggleEffects }: Props) {
  const toConfirm = useUnconfirmed(dm);
  // What is sounding on the deck, shown while the drawer is closed (open, each type's own button says so).
  const playing = useSoundActivity().total;
  return (
    <header className="vtt-top">
      <CampaignSwitcher />
      <RecordingIndicator dm={dm} />
      <span className="vtt-spacer" />
      {dm && <GroupsMenu />}
      {dm && (
        <ToolButton
          label={
            playing > 0
              ? `Sound effects and voices: ${playing} playing`
              : 'Sound effects and voices'
          }
          pressed={effectsOpen}
          {...(!effectsOpen && playing > 0 ? { text: String(playing) } : {})}
          onClick={onToggleEffects}
        >
          <AudioLines size={15} />
        </ToolButton>
      )}
      <ToolButton label="Handouts" onClick={() => void panelOpen('handouts')}>
        <FileText size={15} />
      </ToolButton>
      <ToolButton
        label={
          toConfirm > 0
            ? `Party inventory: ${toConfirm} not added to your sheet yet`
            : 'Party inventory'
        }
        {...(toConfirm > 0 ? { text: String(toConfirm) } : {})}
        onClick={() => void panelOpen('inventory')}
      >
        <Backpack size={15} />
      </ToolButton>
      {dm && (
        <ToolButton label="GM notes and glossary" onClick={() => void panelOpen('notes')}>
          <NotebookPen size={15} />
        </ToolButton>
      )}
      <ToolButton label="Session history" onClick={() => void panelOpen('history')}>
        <ScrollText size={15} />
      </ToolButton>
      <SettingsButton />
    </header>
  );
}
