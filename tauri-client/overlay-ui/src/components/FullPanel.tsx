import { ConnectionStatus } from './ConnectionStatus.js';
import { MicrophoneStatus } from './MicrophoneStatus.js';
import { MuteButton } from './MuteButton.js';
import { ParticipantList } from './ParticipantList.js';

/** The overlay's full mode — Maps VTT pages, or anywhere with the "overlay everywhere" debug
 * flag set. See the Stage 3a design §1. */
export function FullPanel() {
  return (
    <>
      <ConnectionStatus />
      <MicrophoneStatus />
      <MuteButton />
      <ParticipantList />
    </>
  );
}
