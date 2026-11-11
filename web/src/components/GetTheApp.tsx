import { Button, Callout, Flex, Heading, Link, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useWebHandoff } from '../hooks/useWebHandoff.js';
import { isMobile } from '../lib/platform.js';
import { ConnectApp } from './ConnectApp.js';
import { DownloadPage } from './DownloadPage.js';
import { MobileHandoff } from './MobileHandoff.js';
import { SignOutButton } from './SignOutButton.js';

/**
 * The signed-in view on a computer, in the order a returning player needs it: open the app (primary),
 * the web version instead, then the way to get the app if it is not installed yet. A browser cannot tell
 * whether a custom-protocol app is installed, so nothing here tries to; Download is the "don't have it
 * yet" path. The session is a cookie, so the download view and coming back keep it.
 */
export function GetTheApp({ campaignName }: { campaignName?: string }) {
  const server = window.location.origin;
  const [showDownload, setShowDownload] = useState(false);
  const web = useWebHandoff();

  if (isMobile(navigator.userAgent, navigator.maxTouchPoints)) return <MobileHandoff />;
  if (showDownload) return <DownloadPage onBack={() => setShowDownload(false)} />;

  return (
    <Flex direction="column" gap="4">
      <Callout.Root color="green">
        <Callout.Text>
          {campaignName === undefined ? (
            <>You&apos;re signed in.</>
          ) : (
            <>
              You&apos;re in <strong>{campaignName}</strong>.
            </>
          )}
        </Callout.Text>
      </Callout.Root>

      <Flex direction="column" gap="2">
        <Heading size="3">Open the app</Heading>
        <Text size="2" color="gray">
          It lives in your system tray. This hands your sign-in to the app in one click; no password
          to retype.
        </Text>
        <ConnectApp server={server} />
      </Flex>

      <Flex direction="column" gap="1" align="start">
        <Button variant="outline" color="gray" loading={web.state === 'working'} onClick={web.open}>
          Open the web version instead
        </Button>
        <Text size="1" color="gray">
          Chat, whispers, sessions and handouts in your browser. No voice.{' '}
          <Link href="/full-app">What the full app adds</Link>
        </Text>
        {web.state === 'failed' && (
          <Text size="1" color="red" role="alert">
            Couldn&apos;t open the web version. Try again.
          </Text>
        )}
      </Flex>

      <Flex direction="column" gap="2" align="start">
        <Heading size="3">Don&apos;t have the app yet?</Heading>
        <Button variant="soft" size="3" onClick={() => setShowDownload(true)}>
          Download the app
        </Button>
      </Flex>

      <Flex justify="end">
        <SignOutButton />
      </Flex>
    </Flex>
  );
}
