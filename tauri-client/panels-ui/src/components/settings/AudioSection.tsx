import { Mic, Volume2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  accountErrorMessage,
  audioDeviceChoose,
  audioDevices,
  type AudioDeviceList,
} from '../../lib/tauriBridge.js';

const DEFAULT = '';

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

  const row = (
    kind: 'input' | 'output',
    label: string,
    icon: ReactNode,
    devices: { id: string; name: string }[],
    chosen: string | null,
  ) => (
    <label className="vtt-audio-row">
      <span className="vtt-audio-label">
        {icon} {label}
      </span>
      <select
        className="vtt-select"
        aria-label={label}
        value={chosen ?? DEFAULT}
        onChange={(e) => void choose(kind, e.target.value)}
      >
        <option value={DEFAULT}>System default</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="vtt-audio">
      {list &&
        row('input', 'Microphone', <Mic size={14} aria-hidden />, list.inputs, list.chosenInput)}
      {list &&
        row(
          'output',
          'Speaker',
          <Volume2 size={14} aria-hidden />,
          list.outputs,
          list.chosenOutput,
        )}
      {!list && !error && <span className="vtt-muted">Looking for audio devices…</span>}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </div>
  );
}
