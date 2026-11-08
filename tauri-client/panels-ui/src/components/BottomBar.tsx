import { useIsSpeaking } from '../hooks/useIsSpeaking.js';
import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';
import type { Role } from '../lib/commands.js';
import { Composer } from './Composer.js';
import { LevelMeter } from './LevelMeter.js';
import { MuteIcon } from './MuteIcon.js';

/** Mute, the level meter and the message box: always visible, never scrolls away. */
export function BottomBar({
  selfId,
  role,
  drawerOpen,
  onToggleDrawer,
}: {
  selfId: string | null;
  role: Role;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  const speaking = useIsSpeaking(selfId ?? '');
  const muted = useMicrophoneMuted();
  return (
    <footer className="vtt-bottom">
      <MuteIcon />
      <LevelMeter level={speaking && !muted ? 1 : 0} dim={muted} />
      <Composer selfId={selfId} role={role} />
      {role === 'dm' && (
        <button
          type="button"
          className="vtt-pill vtt-pill-square"
          aria-expanded={drawerOpen}
          onClick={onToggleDrawer}
        >
          Effects {drawerOpen ? '▾' : '▴'}
        </button>
      )}
    </footer>
  );
}
