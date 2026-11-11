import { Button, Callout, Code, Flex, Text } from '@radix-ui/themes';

import { useLinkCode } from '../hooks/useLinkCode.js';
import { useSessionEnd } from '../hooks/useSessionEnd.js';
import { connectLink } from '../lib/connect.js';
import { formatCode } from '../lib/linkCode.js';
import { QrCode } from './QrCode.js';

/**
 * Hands this signed-in browser session over to the app: a deep link, a QR of the same link, and
 * the typed code. The code is shown only here and never logged. The session itself is signed out
 * when the page closes or after ten minutes.
 */
export function ConnectApp({ token, server }: { token: string; server: string }) {
  useSessionEnd(token);
  const { state, refresh } = useLinkCode(token);

  if (state.status === 'loading') {
    return (
      <Text size="2" color="gray">
        Getting a connect code…
      </Text>
    );
  }
  if (state.status === 'error') {
    return (
      <Callout.Root color="orange">
        <Callout.Text>
          Couldn&apos;t get a connect code. Sign in from the app&apos;s own screen instead.{' '}
          <Button variant="ghost" onClick={refresh}>
            Try again
          </Button>
        </Callout.Text>
      </Callout.Root>
    );
  }

  const link = connectLink(server, state.code);
  const shown = formatCode(state.code);

  if (state.expired) {
    return (
      <Flex direction="column" gap="2" align="start">
        <Text size="2" color="gray">
          That code has expired.
        </Text>
        <Button onClick={refresh}>New code</Button>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="3" className="connect">
      <Button asChild size="3">
        <a href={link}>Open VTT Chat</a>
      </Button>
      <Text size="2" color="gray">
        If the button does nothing, scan this from the app&apos;s Connect screen, or type the code
        there.
      </Text>
      <Flex gap="4" align="center" wrap="wrap">
        <QrCode text={link} label="QR code that connects the VTT Chat app to this server" />
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Code
          </Text>
          <Code size="6" className="connect-code">
            {shown}
          </Code>
          <Text size="1" color="gray">
            Works once, for 5 minutes.
          </Text>
          <Button variant="soft" size="1" onClick={refresh}>
            New code
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
