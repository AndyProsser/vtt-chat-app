import { Flex, Select } from '@radix-ui/themes';
import { Mic, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  accountErrorMessage,
  audioDeviceChoose,
  audioDevices,
  type AudioDeviceList,
} from '../../lib/tauriBridge.js';
import { SettingRow } from './SettingRow.js';

const DEFAULT = '__default__';

/**
 * Microphone and speaker. The choice is saved and applied at once if you are in voice. Per-player
 * volume and a microphone gain slider are not offered: the voice layer exposes neither (only
 * automatic gain, which is on).
 */
export function AudioSection() {
  const [list, setList] = useState<AudioDeviceList>();
  const [error, setError] = useState<string>();
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
      {!list && !error && <span className="vtt-muted">Looking for audio devices…</span>}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </Flex>
  );
}
