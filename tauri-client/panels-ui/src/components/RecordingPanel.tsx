import { Badge, Button, Callout, Flex, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm, recordingActions } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, recordingControl } from '../lib/tauriBridge.js';
import type { RecordingAction } from '../types/index.js';

const LABELS: Record<RecordingAction, string> = {
  start: 'Start recording',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop recording',
};

/**
 * Everyone sees whether the session is being recorded (consent is visible, CLAUDE.md §8.4); only the
 * DM gets the controls. The server decides — a button press is a request, and the state shown here
 * only changes when the server's `recording.*` frame comes back.
 */
export function RecordingPanel() {
  useTableFeed();
  const { status } = useAccount();
  const recording = useTableStore((s) => s.recording);
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: RecordingAction) {
    if (action === 'stop' && !confirmStop) {
      setConfirmStop(true);
      return;
    }
    setConfirmStop(false);
    setBusy(true);
    setError(undefined);
    try {
      await recordingControl(action);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Flex direction="column" gap="3" p="3">
      <Flex align="center" justify="between">
        <Text weight="bold">Session recording</Text>
        {recording ? (
          <Badge color={recording.capturing ? 'red' : 'amber'}>
            {recording.capturing ? '● Recording' : 'Paused'}
          </Badge>
        ) : (
          <Badge color="gray">Not recording</Badge>
        )}
      </Flex>
      <Text size="2" color="gray">
        {recording
          ? 'Everyone at the table has been told. Private whispers are never recorded.'
          : 'Nothing is being recorded.'}
      </Text>
      {dm ? (
        <Flex gap="2" wrap="wrap">
          {recordingActions(recording).map((action) => (
            <Button
              key={action}
              disabled={busy}
              color={action === 'stop' ? 'red' : undefined}
              variant={action === 'start' || action === 'resume' ? 'solid' : 'soft'}
              onClick={() => void run(action)}
            >
              {action === 'stop' && confirmStop ? 'Really stop?' : LABELS[action]}
            </Button>
          ))}
        </Flex>
      ) : (
        <Text size="1" color="gray">
          Only the DM can start or stop a recording.
        </Text>
      )}
      {error && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
}
