import { Button, Flex } from '@radix-ui/themes';

import { useVoiceTest } from '../../hooks/useVoiceTest.js';
import { VOICE_PRESET_LABEL, VOICE_PRESETS } from '../../lib/voicePreset.js';
import { isVoiceTestBusy, VOICE_TEST_SECONDS, voiceTestText } from '../../lib/voiceTest.js';
import { LevelMeter } from '../LevelMeter.js';
import { SettingRow } from './SettingRow.js';

/**
 * Settings → Audio → Test your voice: record 5 or 10 seconds through the real capture chain, then play the
 * same recording back under each voice tone, so the tone can be chosen by ear (docs/architecture/AUDIO-MIXER.md).
 */
export function VoiceTestRows() {
  const test = useVoiceTest();
  const { status } = test;
  const busy = isVoiceTestBusy(status);
  const hasClip = status.phase === 'ready' || status.phase === 'playing';

  return (
    <>
      <SettingRow label="Test your voice">
        <Flex align="center" gap="2">
          {status.phase === 'recording' && <LevelMeter level={status.level} dim={false} />}
          {busy ? (
            <Button size="1" variant="soft" color="gray" onClick={() => void test.stop()}>
              Stop
            </Button>
          ) : (
            VOICE_TEST_SECONDS.map((seconds) => (
              <Button
                key={seconds}
                size="1"
                variant="soft"
                onClick={() => void test.record(seconds)}
              >
                Record {seconds} s
              </Button>
            ))
          )}
        </Flex>
      </SettingRow>
      <span className="vtt-muted">{voiceTestText(status)}</span>
      {hasClip && (
        <SettingRow label="Play it as">
          <Flex align="center" gap="2" wrap="wrap" justify="end">
            {VOICE_PRESETS.map((preset) => (
              <Button
                key={preset}
                size="1"
                variant="soft"
                disabled={busy}
                onClick={() => void test.play(preset)}
              >
                {VOICE_PRESET_LABEL[preset]}
              </Button>
            ))}
            <Button
              size="1"
              variant="ghost"
              color="gray"
              disabled={busy}
              onClick={() => void test.clear()}
            >
              Discard
            </Button>
          </Flex>
        </SettingRow>
      )}
      {test.error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {test.error}
        </div>
      )}
    </>
  );
}
