import { useAudioEngine, useMicLevel } from '../hooks/useAudioEngine.js';
import { useIsSpeaking } from '../hooks/useIsSpeaking.js';
import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';
import type { Role } from '../lib/commands.js';
import { Composer } from './Composer.js';
import { LevelMeter } from './LevelMeter.js';
import { MuteIcon } from './MuteIcon.js';

/** Mute, the level meter and the message box: always visible, never scrolls away. */
export function BottomBar({ selfId, role }: { selfId: string | null; role: Role }) {
  const speaking = useIsSpeaking(selfId ?? '');
  const muted = useMicrophoneMuted();
  // With the app's own audio engine the meter shows the real microphone level.
  const engine = useAudioEngine();
  const real = useMicLevel(engine?.active === 'mixer' && !muted);
  return (
    <footer className="vtt-bottom">
      <MuteIcon />
      <LevelMeter
        level={engine?.active === 'mixer' ? real : speaking && !muted ? 1 : 0}
        dim={muted}
      />
      <Composer selfId={selfId} role={role} />
    </footer>
  );
}
