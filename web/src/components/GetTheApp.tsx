import { Button, Callout, Code, Flex, Heading, Link, Text } from '@radix-ui/themes';

import { APP_SCHEME, PLATFORM_LABELS } from '../consts/index.js';
import { appLink, detectPlatform } from '../lib/platform.js';
import type { Downloads } from '../types/index.js';

export function GetTheApp({
  campaignName,
  downloads,
}: {
  campaignName: string;
  downloads: Downloads;
}) {
  const platform = detectPlatform(navigator.userAgent);
  const server = window.location.origin;
  const entries = (Object.keys(PLATFORM_LABELS) as (keyof typeof PLATFORM_LABELS)[]).filter(
    (p) => downloads[p],
  );
  const primary = platform !== 'other' ? platform : undefined;

  return (
    <Flex direction="column" gap="4">
      <Callout.Root color="green">
        <Callout.Text>
          You&apos;re in <strong>{campaignName}</strong>. One last step: install the app.
        </Callout.Text>
      </Callout.Root>

      {entries.length === 0 ? (
        <Text color="gray">Ask your DM where to download the app.</Text>
      ) : (
        <Flex direction="column" gap="2">
          {primary && downloads[primary] && (
            <Button asChild size="3">
              <a href={downloads[primary]}>Download for {PLATFORM_LABELS[primary]}</a>
            </Button>
          )}
          <Text size="2" color="gray">
            {primary ? 'Other platforms: ' : 'Download for: '}
            {entries
              .filter((p) => p !== primary)
              .map((p, i) => (
                <span key={p}>
                  {i > 0 && ' · '}
                  <Link href={downloads[p]}>{PLATFORM_LABELS[p]}</Link>
                </span>
              ))}
          </Text>
        </Flex>
      )}

      <Flex direction="column" gap="2">
        <Heading size="3">Then</Heading>
        <ol className="join-steps">
          <li>Install and open the app. It lives in your system tray.</li>
          <li>
            Sign in with the email and password you just used. If it asks for a server, enter{' '}
            <Code>{server}</Code>.
          </li>
          <li>Your campaign appears automatically. Hide the app and play — it stays quiet.</li>
        </ol>
        <Text size="2" color="gray">
          Already installed? <Link href={appLink(APP_SCHEME, server)}>Open the app</Link>.
        </Text>
      </Flex>
    </Flex>
  );
}
