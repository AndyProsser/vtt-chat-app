import { Flex, Select, Switch, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import {
  DEFAULT_NOTIFY_PREFS,
  minuteOf,
  type NotifyPrefs,
  timeOf,
  withQuiet,
  withoutQuiet,
} from '../../lib/notifyPrefs.js';
import { TIME_OPTIONS } from '../../lib/schedule.js';
import { notifyPrefsGet, notifyPrefsSet } from '../../lib/tauriBridge.js';
import { SectionHeading } from './SectionHeading.js';
import { SettingRow } from './SettingRow.js';

const KINDS: {
  key: 'chat' | 'whispers' | 'table' | 'sessions' | 'joinRequests' | 'joinDecisions';
  label: string;
  hint: string;
}[] = [
  {
    key: 'chat',
    label: 'Chat',
    hint: 'A dot on the tray icon when someone writes in the campaign chat. No pop-up.',
  },
  {
    key: 'whispers',
    label: 'Whispers',
    hint: 'A pop-up for a whisper, only while you are in voice and a recording is running.',
  },
  {
    key: 'table',
    label: 'Handouts and loot',
    hint: 'A dot (and a pop-up for a handout), only while you are in the game.',
  },
  {
    key: 'sessions',
    label: 'Sessions',
    hint: 'Reminders, schedule changes and “summary ready”, even when you are not in a game.',
  },
  {
    key: 'joinRequests',
    label: 'Join requests',
    hint: 'For a DM: a pop-up when someone asks to join your campaign.',
  },
  {
    key: 'joinDecisions',
    label: 'Answers to your requests',
    hint: 'A pop-up when a DM lets you in or turns you down.',
  },
];

/** What to be told about while the window is closed, and when not to be disturbed. */
export function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_NOTIFY_PREFS);
  const [error, setError] = useState<string>();
  useEffect(() => {
    notifyPrefsGet().then(setPrefs, () => undefined);
  }, []);
  const change = (next: NotifyPrefs) => {
    setPrefs(next);
    setError(undefined);
    notifyPrefsSet(next).catch(() => setError('Could not save that choice.'));
  };
  const quiet = prefs.quiet;
  return (
    <Flex direction="column" className="vtt-settings-section">
      <SectionHeading
        title="Notifications"
        hint="What to be told about while the window is closed, and when not to be disturbed."
      />
      <div className="vtt-set-card">
        {KINDS.map((k) => (
          <SettingRow key={k.key} label={k.label} hint={k.hint}>
            <Switch
              aria-label={k.label}
              checked={prefs[k.key]}
              onCheckedChange={(on) => change({ ...prefs, [k.key]: on })}
            />
          </SettingRow>
        ))}
        <SettingRow label="Quiet hours" hint="No pop-ups in this window. The tray dot still shows.">
          <Switch
            aria-label="Quiet hours"
            checked={quiet !== null}
            onCheckedChange={(on) => change(on ? withQuiet(prefs) : withoutQuiet(prefs))}
          />
        </SettingRow>
        {quiet && (
          <Flex align="center" gap="2" justify="end" className="vtt-card-note">
            <TimePick
              label="Quiet from"
              value={quiet.from}
              onChange={(from) => change({ ...prefs, quiet: { ...quiet, from } })}
            />
            <Text size="2">to</Text>
            <TimePick
              label="Quiet until"
              value={quiet.to}
              onChange={(to) => change({ ...prefs, quiet: { ...quiet, to } })}
            />
          </Flex>
        )}
      </div>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </Flex>
  );
}

function TimePick({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (minute: number) => void;
}) {
  return (
    <Select.Root value={timeOf(value)} onValueChange={(t) => onChange(minuteOf(t))}>
      <Select.Trigger aria-label={label} style={{ minWidth: 88 }} />
      <Select.Content position="popper" sideOffset={4} className="vtt-dropdown">
        {TIME_OPTIONS.map((t) => (
          <Select.Item key={t} value={t}>
            {t}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
