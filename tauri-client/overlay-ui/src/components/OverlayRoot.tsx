import { useOverlayBridge } from '../hooks/useOverlayBridge.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { ParticipantList } from './ParticipantList.js';

export function OverlayRoot() {
  useOverlayBridge();

  return (
    <div className="vtt-overlay">
      <ConnectionStatus />
      <ParticipantList />
    </div>
  );
}
