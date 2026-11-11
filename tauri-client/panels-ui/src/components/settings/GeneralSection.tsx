import { getVersion } from '@tauri-apps/api/app';
import { Button, Callout, Flex, Switch, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { SettingRow } from './SettingRow.js';

import { readMonitorPref, writeMonitorPref } from '../../lib/monitorPref.js';
import { useUpdate } from '../../hooks/useUpdate.js';
import { updateMessage } from '../../lib/updateInfo.js';

import {
  accountErrorMessage,
  autostartEnabled,
  autostartSet,
  soundboardMonitorSet,
  updateDevBuildsGet,
  updateDevBuildsSet,
} from '../../lib/tauriBridge.js';

/** Start with the computer. Off until chosen; started at login it opens to the tray only. */
export function GeneralSection() {
  const [enabled, setEnabled] = useState<boolean>();
  const [error, setError] = useState<string>();
  const update = useUpdate(false);
  const [monitor, setMonitor] = useState(readMonitorPref);
  const [version, setVersion] = useState<string>();
  const { status } = useAccount();
  const members = useTableStore((st) => st.members);
  const dm = isDm(members, status?.userId ?? null);
  const [checked, setChecked] = useState(false);
  const [devBuilds, setDevBuilds] = useState<boolean>();
  useEffect(() => {
    void updateDevBuildsGet().then(setDevBuilds, () => undefined);
  }, []);
  useEffect(() => {
    void getVersion().then(setVersion, () => undefined);
  }, []);
  useEffect(() => {
    void autostartEnabled().then(setEnabled, (e: unknown) => setError(accountErrorMessage(e)));
  }, []);
  return (
    <Flex direction="column" px="4" pb="4">
      <SettingRow label="Start with my computer" hint="Opens to the tray, window hidden">
        <Switch
          aria-label="Start with my computer"
          disabled={enabled === undefined}
          checked={enabled ?? false}
          onCheckedChange={(next) => {
            setError(undefined);
            autostartSet(next).then(
              () => setEnabled(next),
              (err: unknown) => setError(accountErrorMessage(err)),
            );
          }}
        />
      </SettingRow>
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
      <SettingRow label={`VTT Chat ${version ?? ''}`.trim()}>
        <Flex gap="2">
          <Button
            size="1"
            variant="soft"
            disabled={update.busy !== undefined}
            onClick={() => void update.check(true).then(() => setChecked(true))}
          >
            {update.busy === 'checking' ? 'Checking…' : 'Check for updates'}
          </Button>
          {update.available && (
            <Button size="1" onClick={() => void update.install()}>
              Restart to update
            </Button>
          )}
        </Flex>
      </SettingRow>
      <SettingRow
        label="Include dev builds"
        hint="Early versions that are still being tested. Off means you only get finished releases."
      >
        <Switch
          aria-label="Include dev builds"
          disabled={devBuilds === undefined}
          checked={devBuilds ?? false}
          onCheckedChange={(next) => {
            setError(undefined);
            setChecked(false);
            updateDevBuildsSet(next).then(
              () => setDevBuilds(next),
              (err: unknown) => setError(accountErrorMessage(err)),
            );
          }}
        />
      </SettingRow>
      {update.available && <Text size="2">{updateMessage(update.available)}</Text>}
      {checked && !update.available && !update.error && (
        <Text size="1" color="gray">
          You are up to date.
        </Text>
      )}
      {(update.error ?? error) && (
        <Callout.Root color="red" size="1" role="alert">
          <Callout.Text>{update.error ?? error}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
}
