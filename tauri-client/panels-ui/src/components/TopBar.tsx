import { Activity, AudioLines, Settings, Volume2, VolumeX } from 'lucide-react';

import { useVoice } from '../hooks/useVoice.js';
import { panelOpen } from '../lib/tauriBridge.js';
import { CampaignSwitcher } from './CampaignSwitcher.js';
import { ConnectionMenu } from './ConnectionMenu.js';
import { GroupsMenu } from './GroupsMenu.js';
import { RecordingIndicator } from './RecordingIndicator.js';
import { ToolButton } from './ToolButton.js';

interface Props {
  dm: boolean;
  /** The DM's effects drawer. */
  effectsOpen: boolean;
  onToggleEffects: () => void;
}

/** Record state and timer on the left; on the right, icon buttons (with tip text) for the rest. */
export function TopBar({ dm, effectsOpen, onToggleEffects }: Props) {
  const voice = useVoice();
  return (
    <header className="vtt-top">
      <CampaignSwitcher />
      <RecordingIndicator dm={dm} />
      <span className="vtt-spacer" />
      {dm && <GroupsMenu />}
      {dm && <ConnectionMenu />}
      {dm && (
        <ToolButton
          label="Sound effects and voices"
          pressed={effectsOpen}
          onClick={onToggleEffects}
        >
          <AudioLines size={15} />
        </ToolButton>
      )}
      <ToolButton
        label={
          voice.error ??
          (voice.connected
            ? 'In voice: click to leave (chat stays on)'
            : 'Voice is off: click to join')
        }
        pressed={voice.connected}
        disabled={voice.busy}
        onClick={() => void voice.toggle()}
      >
        {voice.connected ? <Volume2 size={15} /> : <VolumeX size={15} />}
      </ToolButton>
      <ToolButton label="Settings" onClick={() => void panelOpen('settings')}>
        <Settings size={15} />
      </ToolButton>
    </header>
  );
}
