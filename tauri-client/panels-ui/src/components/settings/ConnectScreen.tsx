import { Box, Button, Callout, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useDeviceConnect } from '../../hooks/useDeviceConnect.js';
import { useNow } from '../../hooks/useNow.js';
import { accountErrorMessage, accountOpenConnect } from '../../lib/tauriBridge.js';
import { serverHost } from '../../lib/serverHost.js';
import { isTypeableCode } from '../../lib/typedCode.js';
import type { AccountStatus, ConnectLink } from '../../types/index.js';
import { QrCode } from '../QrCode.js';

interface Props {
  /** A connect link the OS passed in: fills the fields and, if it carries a code, connects with it. */
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
 * (or scan the QR with a phone). A deep link from the web page connects at once; any one-time code (web
 * page, emailed, SSO page, or from the operator) can be typed instead, behind "Have a code instead?".
 */
export function ConnectScreen(props: Props) {
  const { server, onServer, code, onCode } = props;
  const device = useDeviceConnect(props.onStatus);
  const now = useNow(device.phase === 'waiting');
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState<string>();
  // The typed-code box is a fallback: collapsed until asked for, or until a link's connect attempt fails.
  const [codeOpen, setCodeOpen] = useState(false);
  const host = serverHost(server);

  const { link } = props;
  const { cancel } = device;
  // Kept in a ref so a new function identity on a re-render cannot start a second sign-in.
  const connectWithCode = useRef(props.onConnectWithCode);
  connectWithCode.current = props.onConnectWithCode;
  const followed = useRef<ConnectLink | undefined>(undefined);
  useEffect(() => {
    if (!link || followed.current === link) return;
    followed.current = link;
    // A link replaces any waiting request. It fills the fields (so a failure leaves them ready to retry)
    // and, when it carries a code, connects at once: this screen only exists while signed out, so
    // it can never swap an account the player is using.
    cancel();
    onServer(link.server);
    if (link.code) {
      onCode(link.code);
      void connectWithCode.current(link.server, link.code);
    }
  }, [link, cancel, onServer, onCode]);

  useEffect(() => {
    if (props.error && followed.current?.code) setCodeOpen(true);
  }, [props.error]);

  const waiting = device.phase === 'waiting';
  const starting = device.phase === 'starting';
  const waitingHost = serverHost(device.server ?? '');
  const canStart = server.trim() !== '';
  const typeable = isTypeableCode(code);
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
        disabled={waiting || starting}
        onChange={(e) => onServer(e.target.value)}
      />

      {!waiting && (
        <Flex align="center" gap="3" wrap="wrap">
          <Button
            size="3"
            loading={starting}
            disabled={!canStart || starting}
            onClick={() => void device.start(server)}
          >
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
            Approve {waitingHost ? <b>{waitingHost}</b> : 'this'} on the page that opens, and enter
            this code:
          </Text>
          <Heading size="8" className="vtt-connect-code" aria-label="Your code">
            {device.userCode}
          </Heading>
          <Text size="2" color="gray" role="timer">
            Expires in {mmss((device.deadline ?? now) - now)}
          </Text>
          <Button
            size="3"
            onClick={() => {
              setOpenError(undefined);
              accountOpenConnect(device.server ?? '', device.userCode ?? '').catch((e) =>
                setOpenError(accountErrorMessage(e)),
              );
            }}
          >
            Open in browser
          </Button>
          {openError && (
            <Text size="2" color="red" role="alert">
              {openError}
            </Text>
          )}
          <QrCode text={device.approveUrl} label="QR code to approve this sign-in on a phone" />
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              Or open this link yourself:
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

      <Flex direction="column" gap="2" align="start">
        <Button
          variant="ghost"
          size="1"
          aria-expanded={codeOpen}
          aria-controls="connect-typed-code"
          onClick={() => setCodeOpen((v) => !v)}
        >
          Have a code instead?
        </Button>
        {codeOpen && (
          <form
            id="connect-typed-code"
            style={{ width: '100%' }}
            onSubmit={(e) => {
              e.preventDefault();
              device.cancel();
              void props.onConnectWithCode(server, code);
            }}
          >
            <Flex direction="column" gap="2">
              <Text size="2" color="gray">
                Type the code from the web page here.
              </Text>
              {typeable ? (
                <Flex gap="2">
                  <Box flexGrow="1">
                    <TextField.Root
                      aria-label="One-time code"
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
              ) : (
                // Our call: a long link token is kept for a retry but never shown as a giant string.
                <Flex gap="2" align="center">
                  <Text size="2" color="gray">
                    The link brought a sign-in code.
                  </Text>
                  <Button type="submit" variant="soft" loading={props.busy} disabled={!canStart}>
                    Retry
                  </Button>
                  <Button type="button" variant="ghost" size="1" onClick={() => onCode('')}>
                    Type a code instead
                  </Button>
                </Flex>
              )}
            </Flex>
          </form>
        )}
      </Flex>
    </Flex>
  );
}
