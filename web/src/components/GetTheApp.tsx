import { Button, Callout, Flex, Heading, Link, Text } from '@radix-ui/themes';

import { PLATFORM_LABELS } from '../consts/index.js';
import { detectPlatform } from '../lib/platform.js';
import type { Downloads } from '../types/index.js';
import { ConnectApp } from './ConnectApp.js';

export function GetTheApp({
  campaignName,
  downloads,
  token,
}: {
  token: string;
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
        <Heading size="3">Then connect the app</Heading>
        <Text size="2" color="gray">
          Install and open the app — it lives in your system tray. Then connect it to your account
          here; no password to retype.
        </Text>
        <ConnectApp token={token} server={server} />
        <Text size="2" color="gray">
          Your campaign appears automatically. Hide the app and play — it stays quiet.
        </Text>
      </Flex>
    </Flex>
  );
}
