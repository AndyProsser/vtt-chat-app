import { Button, Callout, Flex, Link, Spinner, Text } from '@radix-ui/themes';
import { useEffect, useRef } from 'react';

import { useWebHandoff } from '../hooks/useWebHandoff.js';

/** A phone or tablet goes straight into the web app, signed in; there is no desktop app to offer here. */
export function MobileHandoff() {
  const { state, open } = useWebHandoff();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    open();
  }, [open]);

  return (
    <Flex direction="column" gap="3">
      {state === 'failed' ? (
        <Callout.Root color="orange" role="alert">
          <Callout.Text>
            Couldn&apos;t open your table.{' '}
            <Button variant="ghost" onClick={open}>
              Try again
            </Button>{' '}
            or <Link href="/app">sign in there</Link>.
          </Callout.Text>
        </Callout.Root>
      ) : (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2">Opening your table…</Text>
        </Flex>
      )}
      <Text size="1" color="gray">
        Want voice and the full experience?{' '}
        <Link href="/full-app">See how to get the full app</Link>
      </Text>
    </Flex>
  );
}
