import { Box, Button, Callout, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useDeviceConnect } from '../../hooks/useDeviceConnect.js';
import { useNow } from '../../hooks/useNow.js';
import { serverHost } from '../../lib/serverHost.js';
import type { AccountStatus, ConnectLink } from '../../types/index.js';
import { QrCode } from '../QrCode.js';

interface Props {
  /** A connect link the OS passed in: fills the fields, never signs in by itself. */
  link: ConnectLink | undefined;
  busy: boolean;
  error: string | undefined;
  onStatus: (status: AccountStatus) => void;
  onConnectWithCode: (server: string, code: string) => Promise<void>;
  /** Lets the developer block fill the same fields. */
  server: string;
  onServer: (server: string) => void;
  code: string;
  onCode: (code: string) => void;
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Signed out: type the server, press Connect, then approve the code shown here in any browser
 * (or scan the QR with a phone). A code from the join page can be typed instead.
 */
export function ConnectScreen(props: Props) {
  const { server, onServer, code, onCode } = props;
  const device = useDeviceConnect(props.onStatus);
  const now = useNow(device.phase === 'waiting');
  const [copied, setCopied] = useState(false);
  const host = serverHost(server);

  const { link } = props;
  useEffect(() => {
    if (!link) return;
    onServer(link.server);
    if (link.code) onCode(link.code);
  }, [link, onServer, onCode]);

  const waiting = device.phase === 'waiting';
  const canStart = server.trim() !== '';
  const error = device.phase === 'error' ? device.error : props.error;

  return (
    <Flex direction="column" gap="3" p="4">
      <Heading size="4">Connect</Heading>
      <Text size="2" color="gray">
        Enter your server, press Connect, then approve the code in any browser where you are signed
        in.
      </Text>
      <TextField.Root
        aria-label="Server"
        placeholder="Server (play.example.com, or http://localhost:3000)"
        value={server}
        disabled={waiting}
        onChange={(e) => onServer(e.target.value)}
      />

      {!waiting && (
        <Flex align="center" gap="3" wrap="wrap">
          <Button size="3" disabled={!canStart} onClick={() => void device.start(server)}>
            {device.phase === 'expired' ? 'New code' : 'Connect'}
          </Button>
          {host && (
            <Text size="2" color="gray">
              to <b>{host}</b>
            </Text>
          )}
        </Flex>
      )}

      {device.phase === 'expired' && (
        <Text size="2" color="orange" role="status">
          That code expired. Get a new one.
        </Text>
      )}

      {waiting && device.userCode && device.approveUrl && (
        <Flex direction="column" gap="3" align="start">
          <Text size="2" color="gray">
            Approve {host ? <b>{host}</b> : 'this'} on the page that opens, and enter this code:
          </Text>
          <Heading size="8" className="vtt-connect-code" aria-label="Your code">
            {device.userCode}
          </Heading>
          <Text size="2" color="gray" role="timer">
            Expires in {mmss((device.deadline ?? now) - now)}
          </Text>
          <QrCode text={device.approveUrl} label="QR code to approve this sign-in on a phone" />
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              Or open this link in a browser:
            </Text>
            <Text size="2" className="vtt-connect-url">
              {device.approveUrl}
            </Text>
            <Button
              size="1"
              variant="soft"
              onClick={() => {
                void navigator.clipboard
                  .writeText(device.approveUrl ?? '')
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              <Copy size={12} /> {copied ? 'Copied' : 'Copy link'}
            </Button>
          </Flex>
          <Button variant="outline" color="gray" onClick={device.cancel}>
            Cancel
          </Button>
        </Flex>
      )}

      {error && (
        <Callout.Root color="red" role="alert" size="1">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          device.cancel();
          void props.onConnectWithCode(server, code);
        }}
      >
        <Flex direction="column" gap="2">
          <Text size="2" color="gray">
            Have a code from the web page? Type it here.
          </Text>
          <Flex gap="2">
            <Box flexGrow="1">
              <TextField.Root
                aria-label="Code from the web page"
                placeholder="ABCD-2345"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => onCode(e.target.value)}
              />
            </Box>
            <Button
              type="submit"
              variant="soft"
              loading={props.busy}
              disabled={!canStart || code.trim() === ''}
            >
              Connect{host ? ` to ${host}` : ''}
            </Button>
          </Flex>
        </Flex>
      </form>
    </Flex>
  );
}
