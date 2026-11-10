import { Flex, Select, Slider, Switch } from '@radix-ui/themes';
import { Mic, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAudioEngine, useMicLevel } from '../../hooks/useAudioEngine.js';
import { LevelMeter } from '../LevelMeter.js';

import {
  accountErrorMessage,
  audioDeviceChoose,
  audioDevices,
  audioEngineSet,
  autoGainSet,
  micGainSet,
  type AudioDeviceList,
} from '../../lib/tauriBridge.js';
import { SettingRow } from './SettingRow.js';

const DEFAULT = '__default__';

/**
 * Microphone and speaker, saved and applied at once if you are in voice. The "new audio engine" switch
 * (docs/architecture/AUDIO-MIXER.md) adds a microphone volume with a live level, a volume for each
 * person (on their hover card), and echo cancellation that also covers character voices. It takes
 * effect the next time you join voice.
 */
export function AudioSection() {
  const [list, setList] = useState<AudioDeviceList>();
  const [error, setError] = useState<string>();
  const engine = useAudioEngine();
  const [chosen, setChosen] = useState<'mixer' | 'platform'>();
  const [gain, setGain] = useState<number>();
  const [auto, setAuto] = useState<boolean>();
  const running = engine?.active === 'mixer';
  const level = useMicLevel(running);
  useEffect(() => {
    audioDevices().then(setList, (e: unknown) => setError(accountErrorMessage(e)));
  }, []);

  async function choose(kind: 'input' | 'output', value: string) {
    try {
      setError(undefined);
      await audioDeviceChoose(kind, value === DEFAULT ? null : value);
      setList(await audioDevices());
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  const picker = (
    kind: 'input' | 'output',
    label: string,
    devices: { id: string; name: string }[],
    chosen: string | null,
  ) => (
    <Select.Root value={chosen ?? DEFAULT} onValueChange={(v) => void choose(kind, v)}>
      <Select.Trigger aria-label={label} style={{ maxWidth: 220 }} />
      <Select.Content>
        <Select.Item value={DEFAULT}>System default</Select.Item>
        {devices.map((d) => (
          <Select.Item key={d.id} value={d.id}>
            {d.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );

  return (
    <Flex direction="column" px="4" pt="2">
      {list && (
        <>
          <SettingRow label="Microphone">
            <Flex align="center" gap="2">
              <Mic size={14} aria-hidden />
              {picker('input', 'Microphone', list.inputs, list.chosenInput)}
            </Flex>
          </SettingRow>
          <SettingRow label="Speaker">
            <Flex align="center" gap="2">
              <Volume2 size={14} aria-hidden />
              {picker('output', 'Speaker', list.outputs, list.chosenOutput)}
            </Flex>
          </SettingRow>
        </>
      )}
      {engine && (
        <>
          <SettingRow label="New audio engine (experimental)">
            <Switch
              aria-label="Use the new audio engine"
              checked={(chosen ?? engine.engine) === 'mixer'}
              onCheckedChange={(on) => {
                const next = on ? 'mixer' : 'platform';
                setChosen(next);
                void audioEngineSet(next).catch((e: unknown) => setError(accountErrorMessage(e)));
              }}
            />
          </SettingRow>
          <span className="vtt-muted">
            {(chosen ?? engine.engine) === (engine.active ?? engine.engine)
              ? 'Per-person volume, microphone volume, a live level, and echo cancellation for character voices.'
              : 'Takes effect the next time you join voice (leave and join again).'}
          </span>
          <SettingRow label="Adjust microphone volume automatically">
            <Switch
              aria-label="Adjust microphone volume automatically"
              checked={auto ?? engine.autoGain}
              onCheckedChange={(on) => {
                setAuto(on);
                void autoGainSet(on).catch((e: unknown) => setError(accountErrorMessage(e)));
              }}
            />
          </SettingRow>
          <span className="vtt-muted">
            Keeps quiet and loud talkers at a similar level. Switch it off to set the volume
            yourself. Takes effect the next time you join voice.
          </span>
          {running && (
            <SettingRow label="Microphone volume">
              <Flex align="center" gap="3" style={{ width: 220 }}>
                <Slider
                  aria-label="Microphone volume"
                  min={0}
                  max={4}
                  step={0.05}
                  value={[gain ?? engine.micGain]}
                  onValueChange={([v]) => setGain(v ?? 1)}
                  onValueCommit={([v]) =>
                    void micGainSet(v ?? 1).catch((e: unknown) => setError(accountErrorMessage(e)))
                  }
                />
                <LevelMeter level={level} dim={false} />
              </Flex>
            </SettingRow>
          )}
        </>
      )}
      {!list && !error && <span className="vtt-muted">Looking for audio devices…</span>}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </Flex>
  );
}
