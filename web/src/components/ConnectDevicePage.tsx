import { Button, Callout, Card, Code, Flex, Heading, Spinner, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { useSessionEnd } from '../hooks/useSessionEnd.js';
import { approveDevice, codeFromSearch, describeDevice } from '../lib/device.js';
import type { DescribeResult } from '../lib/device.js';
import { LoginForm } from './LoginForm.js';

const EXPIRED = 'That code has expired or was already used. Start again in the app.';

/** Text from the device is attacker-influenced, so it is shown as text in an isolated ltr span. */
function Isolated({ children }: { children: string }) {
  return (
    <span dir="ltr" className="isolated">
      {children}
    </span>
  );
}

function Approve({ token, code }: { token: string; code: string }) {
  useSessionEnd(token);
  const [described, setDescribed] = useState<DescribeResult>();
  const [outcome, setOutcome] = useState<'done' | 'cancelled' | 'expired' | string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void describeDevice(token, code).then((r) => live && setDescribed(r));
    return () => {
      live = false;
    };
  }, [token, code]);

  async function approve() {
    setBusy(true);
    const r = await approveDevice(token, code);
    setBusy(false);
    setOutcome(r.status === 'approved' ? 'done' : r.status === 'expired' ? 'expired' : r.message);
  }

  if (outcome === 'done') return <Text size="3">Done. Return to the app.</Text>;
  if (outcome === 'cancelled') return <Text size="3">Cancelled. Nothing was connected.</Text>;
  if (!described) {
    return (
      <Flex justify="center" p="4">
        <Spinner size="3" />
      </Flex>
    );
  }
  if (described.status === 'expired' || outcome === 'expired') {
    return (
      <Callout.Root color="red">
        <Callout.Text>{EXPIRED}</Callout.Text>
      </Callout.Root>
    );
  }
  if (described.status === 'error') {
    return (
      <Callout.Root color="orange">
        <Callout.Text>{described.message}</Callout.Text>
      </Callout.Root>
    );
  }

  const { deviceLabel, requestIp } = described.device;
  return (
    <Flex direction="column" gap="3">
      <Heading size="5">Connect this device?</Heading>
      <Text size="3">
        <Isolated>{deviceLabel}</Isolated> · from <Isolated>{requestIp}</Isolated>
      </Text>
      <Flex direction="column" gap="1">
        <Text size="1" color="gray">
          Code shown in the app
        </Text>
        <Code size="5">{code}</Code>
      </Flex>
      <Callout.Root color="orange">
        <Callout.Text>Only approve if you just started connecting the app yourself.</Callout.Text>
      </Callout.Root>
      {outcome !== undefined && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{outcome}</Callout.Text>
        </Callout.Root>
      )}
      <Flex gap="3">
        <Button size="3" loading={busy} onClick={() => void approve()}>
          Approve
        </Button>
        <Button
          size="3"
          variant="soft"
          color="gray"
          disabled={busy}
          onClick={() => setOutcome('cancelled')}
        >
          Cancel
        </Button>
      </Flex>
    </Flex>
  );
}

/** `/connect?c=ABCD-2345`: approve the app's sign-in request from any signed-in browser or phone. */
export function ConnectDevicePage() {
  const [code] = useState(() => codeFromSearch(window.location.search));
  const [token, setToken] = useState<string>();

  return (
    <Flex className="join-shell">
      <Card className="join-card" size="4">
        <Flex direction="column" gap="4">
          <Heading size="6">Connect the app</Heading>
          {code === undefined ? (
            <Text color="gray">
              Open the VTT Chat app, choose Connect, and scan its QR code or open the link it shows.
            </Text>
          ) : token === undefined ? (
            <>
              <Text color="gray">Sign in to approve the app that is asking to connect.</Text>
              <LoginForm onSignedIn={setToken} />
            </>
          ) : (
            <Approve token={token} code={code} />
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
