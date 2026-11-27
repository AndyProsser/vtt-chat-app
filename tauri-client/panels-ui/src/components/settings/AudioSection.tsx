import { Flex, Select, Slider, Switch } from '@radix-ui/themes';
import { Mic, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useAudioEngine, useMicLevel } from '../../hooks/useAudioEngine.js';
import { readMonitorPref, writeMonitorPref } from '../../lib/monitorPref.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { LevelMeter } from '../LevelMeter.js';

import {
  accountErrorMessage,
  audioDeviceChoose,
  audioDevices,
  audioEngineSet,
  autoGainSet,
  micGainSet,
  soundboardMonitorSet,
  noiseFilterSet,
  voicePresetSet,
  type AudioDeviceList,
} from '../../lib/tauriBridge.js';
import {
  isNoiseFilterLevel,
  NOISE_FILTER_HINT,
  NOISE_FILTER_LABEL,
  NOISE_FILTER_LEVELS,
  type NoiseFilterLevel,
} from '../../lib/noiseFilter.js';
import {
  isVoicePreset,
  VOICE_PRESET_HINT,
  VOICE_PRESET_LABEL,
  VOICE_PRESETS,
  type VoicePresetName,
} from '../../lib/voicePreset.js';
import { SectionHeading } from './SectionHeading.js';
import { SettingRow } from './SettingRow.js';

const DEFAULT = '__default__';

/** What the engine switch means right now: `chosen` is for the next call, `active` is this call's. */
function engineNote(chosen: 'mixer' | 'platform', active: 'mixer' | 'platform' | null): string {
  if (active !== null && chosen !== active) {
    return chosen === 'mixer' && active === 'platform'
      ? 'This call is on compatibility audio. The app\u2019s own audio is used the next time you join voice; if it could not open your sound card, it stays on compatibility audio.'
      : 'Takes effect the next time you join voice (leave and join again).';
  }
  return chosen === 'platform'
    ? 'On: no volume for each person, no microphone volume or live level, and no echo cancellation for character voices.'
    : 'Off is best: the app runs its own audio, with a volume for each person, a microphone volume and echo cancellation for everything it plays.';
}

/**
 * Microphone and speaker, saved and applied at once if you are in voice. The app's own audio engine
 * (docs/architecture/AUDIO-MIXER.md) is the default since 0.5.2; "Compatibility audio" switches back to
 * WebRTC's platform layer, kept as the fallback. The switch takes effect the next time you join voice.
 */
export function AudioSection() {
  const [list, setList] = useState<AudioDeviceList>();
  const [error, setError] = useState<string>();
  const engine = useAudioEngine();
  const [chosen, setChosen] = useState<'mixer' | 'platform'>();
  const [gain, setGain] = useState<number>();
  const [auto, setAuto] = useState<boolean>();
  const [filter, setFilter] = useState<NoiseFilterLevel>();
  const [tone, setTone] = useState<VoicePresetName>();
  const [monitor, setMonitor] = useState(readMonitorPref);
  const { status } = useAccount();
  const members = useTableStore((st) => st.members);
  const dm = isDm(members, status?.userId ?? null);
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
      <Select.Content position="popper" sideOffset={4} className="vtt-dropdown">
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
    <Flex direction="column" className="vtt-settings-section">
      <SectionHeading
        title="Audio"
        hint="Your microphone and speaker, saved at once and applied if you are in voice."
      />
      <div className="vtt-set-card">
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
            <SettingRow
              label="Compatibility audio"
              hint="Only if voice sounds wrong: hands the sound card to the system's own audio layer."
            >
              <Switch
                aria-label="Use compatibility audio"
                checked={(chosen ?? engine.engine) === 'platform'}
                onCheckedChange={(on) => {
                  const next = on ? 'platform' : 'mixer';
                  setChosen(next);
                  void audioEngineSet(next).catch((e: unknown) => setError(accountErrorMessage(e)));
                }}
              />
            </SettingRow>
            <span className="vtt-muted">{engineNote(chosen ?? engine.engine, engine.active)}</span>
            <SettingRow label="Background noise">
              <Select.Root
                value={filter ?? engine.noiseFilter}
                onValueChange={(v) => {
                  if (!isNoiseFilterLevel(v)) return;
                  setFilter(v);
                  void noiseFilterSet(v).catch((e: unknown) => setError(accountErrorMessage(e)));
                }}
              >
                <Select.Trigger aria-label="Background noise filter" style={{ minWidth: 130 }} />
                <Select.Content position="popper" sideOffset={4} className="vtt-dropdown">
                  {NOISE_FILTER_LEVELS.map((level) => (
                    <Select.Item key={level} value={level}>
                      {NOISE_FILTER_LABEL[level]}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </SettingRow>
            <span className="vtt-muted">{NOISE_FILTER_HINT[filter ?? engine.noiseFilter]}</span>
            <SettingRow label="Voice tone">
              <Select.Root
                value={tone ?? engine.voicePreset}
                onValueChange={(v) => {
                  if (!isVoicePreset(v)) return;
                  setTone(v);
                  void voicePresetSet(v).catch((e: unknown) => setError(accountErrorMessage(e)));
                }}
              >
                <Select.Trigger aria-label="Voice tone" style={{ minWidth: 130 }} />
                <Select.Content position="popper" sideOffset={4} className="vtt-dropdown">
                  {VOICE_PRESETS.map((preset) => (
                    <Select.Item key={preset} value={preset}>
                      {VOICE_PRESET_LABEL[preset]}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </SettingRow>
            <span className="vtt-muted">{VOICE_PRESET_HINT[tone ?? engine.voicePreset]}</span>
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
                      void micGainSet(v ?? 1).catch((e: unknown) =>
                        setError(accountErrorMessage(e)),
                      )
                    }
                  />
                  <LevelMeter level={level} dim={false} />
                </Flex>
              </SettingRow>
            )}
          </>
        )}
        {dm && (
          <SettingRow
            label="Hear sound effects myself"
            hint="Everyone else hears them through the call. Turn off if you use speakers."
          >
            <Switch
              aria-label="Hear sound effects on my own speakers"
              checked={monitor}
              onCheckedChange={(next) => {
                setMonitor(next);
                writeMonitorPref(next);
                void soundboardMonitorSet(next).catch(() => undefined);
              }}
            />
          </SettingRow>
        )}
      </div>
      {!list && !error && <span className="vtt-muted">Looking for audio devices…</span>}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </Flex>
  );
}
