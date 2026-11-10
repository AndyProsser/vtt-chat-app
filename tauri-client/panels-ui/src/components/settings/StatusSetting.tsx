import { Flex, Select } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useStatus } from '../../hooks/useStatus.js';
import {
  AWAY_MINUTE_CHOICES,
  awayMinutesLabel,
  STATUS_HINTS,
  STATUS_LABELS,
  STATUSES,
} from '../../lib/status.js';
import type { Status } from '../../lib/statusStore.js';
import { awayMinutesGet, awayMinutesSet } from '../../lib/tauriBridge.js';
import { SettingRow } from './SettingRow.js';

/** Status, and when to go Away by yourself (screen lock always counts; this is the idle timer). */
export function StatusSetting() {
  const { status, busy, error, change } = useStatus();
  const [minutes, setMinutes] = useState<number>();
  useEffect(() => {
    awayMinutesGet().then(setMinutes, () => undefined);
  }, []);
  return (
    <Flex direction="column" gap="2">
      <SettingRow label="Status">
        <Select.Root value={status} disabled={busy} onValueChange={(v) => void change(v as Status)}>
          <Select.Trigger aria-label="Status" style={{ minWidth: 120 }} />
          <Select.Content>
            {STATUSES.map((s) => (
              <Select.Item key={s} value={s}>
                {STATUS_LABELS[s]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </SettingRow>
      <span className="vtt-muted">{STATUS_HINTS[status]}</span>
      <SettingRow label="Go Away when idle">
        <Select.Root
          value={String(minutes ?? 10)}
          onValueChange={(v) => {
            setMinutes(Number(v));
            void awayMinutesSet(Number(v));
          }}
        >
          <Select.Trigger aria-label="Go Away when idle" style={{ minWidth: 160 }} />
          <Select.Content>
            {AWAY_MINUTE_CHOICES.map((m) => (
              <Select.Item key={m} value={String(m)}>
                {awayMinutesLabel(m)}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </SettingRow>
      <span className="vtt-muted">
        Away also starts when the screen locks, and ends when you unlock or use the keyboard.
      </span>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </Flex>
  );
}
