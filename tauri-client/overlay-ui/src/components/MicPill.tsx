import { MicrophoneStatus } from './MicrophoneStatus.js';
import { MuteButton } from './MuteButton.js';

/** The overlay's pill mode — non-Maps allowed DDB pages, so a player mid-session isn't left
 * without mute or mic-state feedback while push-to-talk stays app-focused-only. See the
 * Stage 3a design §1, "Why a pill instead of nothing off-Maps". */
export function MicPill() {
  return (
    <>
      <MicrophoneStatus />
      <MuteButton />
    </>
  );
}
