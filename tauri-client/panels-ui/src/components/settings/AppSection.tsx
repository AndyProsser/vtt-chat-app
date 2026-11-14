import { Button, Callout, Flex, Switch, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useUpdate } from '../../hooks/useUpdate.js';
import { useVersionCheck } from '../../hooks/useVersionCheck.js';
import {
  accountErrorMessage,
  autostartEnabled,
  autostartSet,
  updateDevBuildsGet,
  updateDevBuildsSet,
} from '../../lib/tauriBridge.js';
import { updateMessage } from '../../lib/updateInfo.js';
import { SectionHeading } from './SectionHeading.js';
import { SettingRow } from './SettingRow.js';

/** The app itself: its versions, updates, and starting with the computer (opens to the tray only). */
export function AppSection() {
  const [enabled, setEnabled] = useState<boolean>();
  const [error, setError] = useState<string>();
  const update = useUpdate(false);
  const version = useVersionCheck();
  const [checked, setChecked] = useState(false);
  const [devBuilds, setDevBuilds] = useState<boolean>();
  useEffect(() => {
    void updateDevBuildsGet().then(setDevBuilds, () => undefined);
  }, []);
  useEffect(() => {
    void autostartEnabled().then(setEnabled, (e: unknown) => setError(accountErrorMessage(e)));
  }, []);
  return (
    <Flex direction="column" className="vtt-settings-section">
      <SectionHeading
        title="App"
        hint={
          version
            ? `App ${version.appVersion}${version.serverVersion ? ` · Server ${version.serverVersion}` : ''}`
            : undefined
        }
      />
      <div className="vtt-set-card">
        <SettingRow label="Updates">
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
        {update.available && (
          <Text size="2" className="vtt-card-note">
            {updateMessage(update.available)}
          </Text>
        )}
        {checked && !update.available && !update.error && (
          <Text size="1" color="gray" className="vtt-card-note">
            You are up to date.
          </Text>
        )}
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
      </div>
      {(update.error ?? error) && (
        <Callout.Root color="red" size="1" role="alert">
          <Callout.Text>{update.error ?? error}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
}
