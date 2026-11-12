import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';

import { FULL_APP_FEATURES } from '../consts/fullApp.js';
import { Command } from './InstallSteps.js';

interface Shareable {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
}

/**
 * Public, mobile-first: what the desktop app adds over the web version, and how to get it from a computer.
 * The address is shown and copyable; "Send to my computer" appears only where the browser can share.
 */
export function FullAppPage() {
  const url = `${window.location.origin}/download`;
  const nav: Shareable = navigator;
  const canShare = typeof nav.share === 'function';

  return (
    <Flex className="join-shell" direction="column" gap="4">
      <Card className="join-card" size="4">
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Heading size="6">Get the full app</Heading>
            <Text color="gray">
              The web version covers chat, whispers, sessions and handouts. Voice lives in the
              desktop app for Windows, macOS and Linux.
            </Text>
          </Flex>
          <Flex direction="column" gap="2">
            <Heading size="3" as="h2">
              What the desktop app adds
            </Heading>
            <ul className="full-app-list">
              {FULL_APP_FEATURES.map((f) => (
                <li key={f.title}>
                  <Text size="2" weight="medium">
                    {f.title}.
                  </Text>{' '}
                  <Text size="2" color="gray">
                    {f.text}
                  </Text>
                </li>
              ))}
            </ul>
          </Flex>
          <Flex direction="column" gap="2">
            <Heading size="3" as="h2">
              How to get it
            </Heading>
            <Text size="2">On a computer, open this page and sign in to download:</Text>
            <Command command={url} />
            {canShare && (
              <Button
                variant="soft"
                size="3"
                onClick={() => {
                  nav
                    .share?.({ title: 'VTT Chat', text: 'Get the VTT Chat app', url })
                    .catch(() => {
                      /* dismissed or unavailable: the address above is still there to copy */
                    });
                }}
              >
                Send this link to my computer
              </Button>
            )}
            <Button asChild variant="ghost" size="2">
              <a href="/download">Open the download page</a>
            </Button>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
