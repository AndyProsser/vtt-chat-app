import { Callout, Flex, Heading, Text } from '@radix-ui/themes';

import type { Downloads } from '../types/index.js';
import { ConnectApp } from './ConnectApp.js';
import { DownloadLinks, hasDownloads } from './DownloadLinks.js';

export function GetTheApp({
  campaignName,
  downloads,
  token,
}: {
  token: string;
  campaignName?: string;
  downloads: Downloads;
}) {
  const server = window.location.origin;

  return (
    <Flex direction="column" gap="4">
      <Callout.Root color="green">
        <Callout.Text>
          {campaignName === undefined ? (
            <>You&apos;re signed in. Install the app, then connect it.</>
          ) : (
            <>
              You&apos;re in <strong>{campaignName}</strong>. One last step: install the app.
            </>
          )}
        </Callout.Text>
      </Callout.Root>

      {hasDownloads(downloads) ? (
        <DownloadLinks downloads={downloads} />
      ) : (
        <Text color="gray">Ask your DM where to download the app.</Text>
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
