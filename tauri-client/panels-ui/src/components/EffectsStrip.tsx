import { Popover } from '@radix-ui/themes';
import {
  AudioLines,
  Clapperboard,
  CloudRain,
  PawPrint,
  Repeat,
  Square,
  Volume2,
  Wind,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { ToolButton } from './ToolButton.js';
import { VoiceStrip } from './VoiceStrip.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { categoriesOf, type SoundCategory } from '../lib/soundCategories.js';
import { boardIcon, soundIcon } from '../lib/soundIcons.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';
import type { SoundLibrary } from '../types/index.js';

const SCENES_TAB = 'scenes';
type Tab = 'voice' | SoundCategory | typeof SCENES_TAB;

const CATEGORIES: { tab: Tab; label: string; icon: typeof Wind }[] = [
  { tab: 'voice', label: 'Voice: character voices', icon: AudioLines },
  { tab: 'environment', label: 'Environment: one-shot sounds', icon: Wind },
  { tab: 'background', label: 'Background: loops (fire, rain, tavern)', icon: CloudRain },
  { tab: 'creatures', label: 'Creatures and animals', icon: PawPrint },
];

/**
 * The DM's drawer. The buttons only *ask*; the server picks the take and tells every client, and the
 * DM's app sends the sound through the call (so it is never echoed back). Voice, Environment,
 * Background and Creatures are the top-level tabs; inside a category the boards are a second row of
 * icons, and the sounds below are rounded icon buttons (the name is the tooltip).
 */
export function EffectsStrip() {
  const { data, error } = useCampaignQuery<SoundLibrary>('soundboard/library', []);
  const [master, setMaster] = useState(100);
  const [tab, setTab] = useState<Tab>('environment');
  const [boardId, setBoardId] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  async function send(t: string, d: Record<string, unknown>) {
    try {
      setActionError(undefined);
      await syncCommand(t, d);
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  const problem = error ?? actionError;
  const scenes = data?.scenes ?? [];
  const byCategory = useMemo(() => categoriesOf(data?.boards ?? []), [data]);
  const boards = tab === 'voice' || tab === SCENES_TAB ? [] : byCategory[tab];
  const board = boards.find((b) => b.id === boardId) ?? boards[0];
  const tabs =
    scenes.length > 0
      ? [...CATEGORIES, { tab: SCENES_TAB as Tab, label: 'Scenes', icon: Clapperboard }]
      : CATEGORIES;
  return (
    <div className="vtt-drawer-body">
      <div className="vtt-drawer-row">
        {tabs.map(({ tab: t, label, icon: Icon }) => (
          <ToolButton key={t} label={label} pressed={tab === t} onClick={() => setTab(t)}>
            <Icon size={15} />
          </ToolButton>
        ))}
        <span className="vtt-drawer-divider" aria-hidden />
        <ToolButton danger label="Stop every sound" onClick={() => void send('sound.stop', {})}>
          <Square size={14} />
        </ToolButton>
        <Popover.Root>
          <Popover.Trigger>
            <ToolButton label="Table volume">
              <Volume2 size={15} />
            </ToolButton>
          </Popover.Trigger>
          <Popover.Content size="1" width="200px">
            <label className="vtt-volume">
              <Volume2 size={15} aria-hidden />
              <input
                type="range"
                aria-label="Table volume"
                min={0}
                max={100}
                value={master}
                onChange={(e) => setMaster(Number(e.target.value))}
                onPointerUp={() => void send('sound.volume', { master: master / 100 })}
                onKeyUp={() => void send('sound.volume', { master: master / 100 })}
              />
            </label>
          </Popover.Content>
        </Popover.Root>
      </div>
      {problem && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {problem}
        </div>
      )}
      {tab === 'voice' && <VoiceStrip />}
      {tab === SCENES_TAB && (
        <div className="vtt-sound-grid">
          {scenes.map((sc) => (
            <ToolButton
              key={sc.id}
              label={`Start scene: ${sc.name}`}
              text={sc.name}
              onClick={() => void send('scene.start', { sceneId: sc.id })}
            >
              <Clapperboard size={13} />
            </ToolButton>
          ))}
          <ToolButton label="End the scene" onClick={() => void send('scene.stop', {})}>
            <Square size={13} />
          </ToolButton>
        </div>
      )}
      {boards.length > 1 && (
        <div className="vtt-drawer-row">
          {boards.map((b) => {
            const Icon = boardIcon(b.name);
            return (
              <ToolButton
                key={b.id}
                label={b.name}
                pressed={board?.id === b.id}
                onClick={() => setBoardId(b.id)}
              >
                <Icon size={15} />
              </ToolButton>
            );
          })}
        </div>
      )}
      {board && (
        <div className="vtt-sound-grid" aria-label={board.name}>
          {board.buttons.map((btn) => {
            const Icon = soundIcon(btn.label);
            return (
              <ToolButton
                key={btn.id}
                label={`${btn.label}${btn.note ? ` — ${btn.note}` : ''}${btn.mode === 'loop' ? ' (loops)' : ''}`}
                className={btn.mode === 'loop' ? 'vtt-tool-loop' : undefined}
                onClick={() =>
                  void send('sound.play', {
                    soundId: btn.soundId,
                    mode: btn.mode,
                    volume: btn.volume,
                  })
                }
              >
                {btn.mode === 'loop' ? <Repeat size={15} /> : <Icon size={15} />}
              </ToolButton>
            );
          })}
        </div>
      )}
      {data && tab !== 'voice' && tab !== SCENES_TAB && boards.length === 0 && (
        <span className="vtt-muted">Nothing in this category yet.</span>
      )}
    </div>
  );
}
