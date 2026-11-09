import { Bot, Flame, Mountain, Skull, User } from 'lucide-react';

import { useVoiceEffect } from '../hooks/useVoiceEffect.js';
import { VOICES } from '../lib/commands.js';
import { ToolButton } from './ToolButton.js';

const VOICE_ICON: Record<(typeof VOICES)[number], typeof User> = {
  normal: User,
  giant: Mountain,
  imp: Flame,
  robot: Bot,
  demon: Skull,
};

const TIP: Record<(typeof VOICES)[number], string> = {
  normal: 'Your own voice',
  giant: 'Giant: slow and deep',
  imp: 'Imp: small and shrill',
  robot: 'Robot: metallic',
  demon: 'Demon: low and growling',
};

/** The DM's character voices, as icons. Anything but your own voice turns echo cancellation off. */
export function VoiceStrip() {
  const { current, error, choose } = useVoiceEffect();
  return (
    <div className="vtt-deck-chips">
      {VOICES.map((v) => {
        const Icon = VOICE_ICON[v];
        return (
          <ToolButton key={v} label={TIP[v]} pressed={v === current} onClick={() => void choose(v)}>
            <Icon size={15} />
          </ToolButton>
        );
      })}
      {current !== 'normal' && (
        <span className="vtt-muted">Echo cancellation is off while a character voice is on.</span>
      )}
      {error && (
        <span className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </span>
      )}
    </div>
  );
}
