import { Callout, Flex, Heading, Link, Text } from '@radix-ui/themes';

import { isMobile } from '../lib/platform.js';
import { ConnectApp } from './ConnectApp.js';
import { MobileHandoff } from './MobileHandoff.js';
import { SignOutButton } from './SignOutButton.js';

/**
 * The signed-in view on a computer: open the app (the one primary action) and, for someone who has not
 * installed it, a plain hint to the Downloads page. The web version is the Chat link in the header. A
 * browser cannot tell whether a custom-protocol app is installed, so nothing here tries to. The session
 * is a cookie, so coming back keeps it.
 */
export function GetTheApp({ campaignName }: { campaignName?: string }) {
  const server = window.location.origin;

  if (isMobile(navigator.userAgent, navigator.maxTouchPoints)) return <MobileHandoff />;

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
        <Heading size="3" as="h2">
          Open the app
        </Heading>
        <Text size="2" color="gray">
          It lives in your system tray. This hands your sign-in to the app in one click; no password
          to retype.
        </Text>
        <ConnectApp server={server} />
      </Flex>

      <Text size="2" color="gray">
        Don&apos;t have the app yet? Grab it from the <Link href="/download">Downloads page</Link>.
        Want chat without installing anything? Use <Link href="/app">Chat</Link> in the menu.{' '}
        <Link href="/full-app">What the full app adds</Link>
      </Text>

      <Flex justify="end">
        <SignOutButton />
      </Flex>
    </Flex>
  );
}
