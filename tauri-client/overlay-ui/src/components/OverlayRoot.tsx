import { useOverlayBridge } from '../hooks/useOverlayBridge.js';
import { useOverlayVisible } from '../hooks/useOverlayVisible.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { MicrophoneStatus } from './MicrophoneStatus.js';
import { ParticipantList } from './ParticipantList.js';

export function OverlayRoot() {
  // Called before the visibility check on purpose: the bridge owns the Tauri event listeners,
  // including the `overlay:toggle` one that makes the overlay visible again. Unmounting it while
  // hidden would leave nothing listening for the key that brings it back — and would tear down
  // the LiveKit session wiring along with it.
  useOverlayBridge();
  const visible = useOverlayVisible();

  if (!visible) return null;

  return (
    <div className="vtt-overlay">
      <ConnectionStatus />
      <MicrophoneStatus />
      <ParticipantList />
    </div>
  );
}
