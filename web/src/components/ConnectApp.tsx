import { Button, Callout, Code, Flex, Text } from '@radix-ui/themes';

import { useLinkCode } from '../hooks/useLinkCode.js';
import { useSessionEnd } from '../hooks/useSessionEnd.js';
import { connectLink } from '../lib/connect.js';
import { formatCode, formatCountdown } from '../lib/linkCode.js';

/**
 * Hands this signed-in browser session over to the app: a deep link and the typed code. (No QR
 * here: a phone has no app to open the deep link, and the app has no scanner. The working QR is the
 * app's own, which a signed-in phone scans to approve at `/connect`.) The code is shown only here and never logged. The session itself is signed out
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
          {state.sessionEnded ? (
            'Your sign-in here has ended — reload the page to sign in again.'
          ) : (
            <>
              Couldn&apos;t get a connect code. Sign in from the app&apos;s own screen instead.{' '}
              <Button variant="ghost" onClick={refresh}>
                Try again
              </Button>
            </>
          )}
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
        If the button does nothing, type this code into the app&apos;s Connect screen (“Have a code?
        Type it here”).
      </Text>
      <Flex direction="column" gap="1" align="start">
        <Text size="1" color="gray">
          Code
        </Text>
        <Code size="6" className="connect-code">
          {shown}
        </Code>
        <Text size="1" color="gray">
          Works once. Expires in {formatCountdown(state.secondsLeft)}
        </Text>
        <Button variant="soft" size="1" onClick={refresh}>
          New code
        </Button>
      </Flex>
    </Flex>
  );
}
