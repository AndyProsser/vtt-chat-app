import { Button, Callout, Code, Flex, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useLinkCode } from '../hooks/useLinkCode.js';
import { useSessionEnd } from '../hooks/useSessionEnd.js';
import { connectLink } from '../lib/connect.js';
import { formatCode, formatCountdown } from '../lib/linkCode.js';

/**
 * Hands this signed-in browser session over to the app: a deep link (carrying a long single-use token) and, behind a disclosure, a short typed code. (No QR
 * here: a phone has no app to open the deep link, and the app has no scanner. The working QR is the
 * app's own, which a signed-in phone scans to approve at `/connect`.) The code is shown only here and never logged. The session itself is signed out
 * when the page closes or after ten minutes.
 */
export function ConnectApp({ token, server }: { token: string; server: string }) {
  useSessionEnd(token);
  const { state, refresh } = useLinkCode(token);
  const [showCode, setShowCode] = useState(false);

  if (state.status === 'loading') {
    return (
      <Text size="2" color="gray">
        Getting a connect link…
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
              Couldn&apos;t get a connect link. Sign in from the app&apos;s own screen instead.{' '}
              <Button variant="ghost" onClick={refresh}>
                Try again
              </Button>
            </>
          )}
        </Callout.Text>
      </Callout.Root>
    );
  }

  const link = connectLink(server, state.linkToken);
  const shown = formatCode(state.code);

  if (state.expired) {
    return (
      <Flex direction="column" gap="2" align="start">
        <Text size="2" color="gray">
          That link has expired.
        </Text>
        <Button onClick={refresh}>Try again</Button>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2" className="connect" align="start">
      <Button asChild size="3">
        <a href={link}>Open VTT Chat</a>
      </Button>
      <Button
        variant="ghost"
        size="1"
        aria-expanded={showCode}
        aria-controls="connect-code-panel"
        onClick={() => setShowCode((v) => !v)}
      >
        Can&apos;t open the app? Show a code
      </Button>
      {showCode && (
        <Flex id="connect-code-panel" direction="column" gap="1" align="start">
          <Text size="1" color="gray">
            Type this into the app&apos;s Connect screen (“Have a code instead?”).
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
      )}
    </Flex>
  );
}
