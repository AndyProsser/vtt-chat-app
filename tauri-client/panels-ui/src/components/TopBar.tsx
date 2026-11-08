import { GearIcon, SpeakerLoudIcon, SpeakerOffIcon } from '@radix-ui/react-icons';

import { useVoice } from '../hooks/useVoice.js';
import { panelOpen } from '../lib/tauriBridge.js';
import { RecordingIndicator } from './RecordingIndicator.js';

/** Record state and timer, the voice Connect/Disconnect toggle, and the settings cog. */
export function TopBar({ dm }: { dm: boolean }) {
  const voice = useVoice();
  return (
    <header className="vtt-top">
      <RecordingIndicator dm={dm} />
      <span className="vtt-spacer" />
      <button
        type="button"
        className="vtt-pill"
        disabled={voice.busy}
        title={voice.error ?? (voice.connected ? 'Leave voice (chat stays on)' : 'Join voice')}
        onClick={() => void voice.toggle()}
      >
        {voice.connected ? <SpeakerLoudIcon /> : <SpeakerOffIcon />}
        {voice.connected ? 'Connected' : voice.busy ? 'Connecting…' : 'Voice off'}
      </button>
      <button
        type="button"
        className="vtt-pill"
        aria-label="Settings"
        onClick={() => void panelOpen('settings')}
      >
        <GearIcon />
      </button>
    </header>
  );
}
