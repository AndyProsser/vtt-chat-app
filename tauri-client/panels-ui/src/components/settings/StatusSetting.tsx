import { Flex } from '@radix-ui/themes';
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
import { Dropdown } from '../Dropdown.js';
import { SectionHeading } from './SectionHeading.js';
import { SettingRow } from './SettingRow.js';

/** Status, and when to go Away by yourself (screen lock always counts; this is the idle timer). */
export function StatusSetting() {
  const { status, busy, error, change } = useStatus();
  const [minutes, setMinutes] = useState<number>();
  useEffect(() => {
    awayMinutesGet().then(setMinutes, () => undefined);
  }, []);
  return (
    <Flex direction="column" className="vtt-settings-section">
      <SectionHeading title="Presence" hint="What others see, and when you step away." />
      <div className="vtt-set-card">
        <SettingRow label="Status" hint={STATUS_HINTS[status]}>
          <Dropdown
            label="Status"
            value={status}
            disabled={busy}
            width={130}
            onChange={(v) => void change(v as Status)}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          />
        </SettingRow>
        <SettingRow
          label="Go Away when idle"
          hint="Away also starts when the screen locks, and ends when you unlock or use the keyboard."
        >
          <Dropdown
            label="Go Away when idle"
            value={String(minutes ?? 10)}
            width={130}
            onChange={(v) => {
              setMinutes(Number(v));
              void awayMinutesSet(Number(v));
            }}
            options={AWAY_MINUTE_CHOICES.map((m) => ({
              value: String(m),
              label: awayMinutesLabel(m),
            }))}
          />
        </SettingRow>
        {error && (
          <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
            {error}
          </div>
        )}
      </div>
    </Flex>
  );
}
