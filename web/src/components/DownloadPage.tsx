import { Button, Callout, Card, Code, Flex, Heading, Link, Tabs, Text } from '@radix-ui/themes';
import { SegmentedControl } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import {
  INSTALL_GUIDE_URL,
  LINUX_GUIDES,
  LINUX_NOTES,
  MACOS_GUIDE,
  WINDOWS_GUIDE,
} from '../consts/installGuide.js';
import { useSession } from '../hooks/useSession.js';
import { ApiError, request } from '../lib/api.js';
import { markSignedOut } from '../lib/session.js';
import { detectPlatform } from '../lib/platform.js';
import type { Downloads, InstallGuide } from '../types/index.js';
import { ConnectApp } from './ConnectApp.js';
import { InstallSteps } from './InstallSteps.js';
import { LoginForm } from './LoginForm.js';
import { SignOutButton } from './SignOutButton.js';

type Tab = 'windows' | 'macos' | 'linux';
const LINUX_URL: Record<string, keyof Downloads> = {
  appimage: 'linux',
  deb: 'linuxDeb',
  rpm: 'linuxRpm',
};

/** A guide's own words, with its download button (or a note when the server has no link for it). */
function Option({ guide, url, platform }: { guide: InstallGuide; url?: string; platform: string }) {
  return (
    <Flex direction="column" gap="3" className="fit">
      <Text size="2" color="gray">
        {guide.who}
      </Text>
      {url ? (
        <Button asChild size="3">
          <a href={url}>Download for {platform}</a>
        </Button>
      ) : (
        <Callout.Root color="orange">
          <Callout.Text>
            This server has no download link for this one yet. Ask your DM for the file.
          </Callout.Text>
        </Callout.Root>
      )}
      <InstallSteps guide={guide} />
    </Flex>
  );
}

function LinuxOptions({ downloads }: { downloads: Downloads }) {
  const offered = LINUX_GUIDES.filter((g) => downloads[LINUX_URL[g.id]!]);
  const choices = offered.length > 0 ? offered : LINUX_GUIDES;
  const [format, setFormat] = useState(choices[0]!.id);
  const guide = choices.find((g) => g.id === format) ?? choices[0]!;
  return (
    <Flex direction="column" gap="3" className="fit">
      <SegmentedControl.Root className="segmented-fit" value={guide.id} onValueChange={setFormat}>
        {choices.map((g) => (
          <SegmentedControl.Item key={g.id} value={g.id}>
            {g.label}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
      <Option
        key={guide.id}
        guide={guide}
        url={downloads[LINUX_URL[guide.id]!]}
        platform={`Linux (${guide.label})`}
      />
      <Flex direction="column" gap="1">
        {LINUX_NOTES.map((n) => (
          <Text key={n} size="1" color="gray">
            {n}
          </Text>
        ))}
      </Flex>
    </Flex>
  );
}

/** Why the links could not be loaded, in words for the visitor. */
function failure(e: unknown): string {
  return e instanceof ApiError && e.status === 401
    ? 'Your sign-in here has ended. Sign in again to continue.'
    : 'Couldn’t load the download links. Reload the page to try again.';
}

function DownloadContent({ onBack }: { onBack?: () => void }) {
  const detected = detectPlatform(navigator.userAgent);
  const [tab, setTab] = useState<Tab>(detected === 'other' ? 'windows' : detected);
  const [downloads, setDownloads] = useState<Downloads>({});
  const [error, setError] = useState<string>();
  useEffect(() => {
    void request<Downloads>('GET', '/api/downloads').then(setDownloads, (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) markSignedOut();
      setError(failure(e));
    });
  }, []);

  return (
    <Flex direction="column" gap="4" className="fit">
      <Flex justify="between" align="center" gap="3">
        <Heading size="6">Get VTT Chat</Heading>
        <Flex gap="3" align="center">
          {onBack && (
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          )}
          <SignOutButton />
        </Flex>
      </Flex>
      {error && (
        <Callout.Root color="orange">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {detected === 'other' && (
        <Callout.Root color="gray">
          <Callout.Text>
            The app is for Windows, macOS and Linux computers. On a phone, open the{' '}
            <Link href="/app">phone app</Link> instead.
          </Callout.Text>
        </Callout.Root>
      )}
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <Tabs.List>
          <Tabs.Trigger value="windows">Windows</Tabs.Trigger>
          <Tabs.Trigger value="macos">macOS</Tabs.Trigger>
          <Tabs.Trigger value="linux">Linux</Tabs.Trigger>
        </Tabs.List>
        <Flex pt="4" direction="column" className="fit">
          <Tabs.Content value="windows">
            <Option guide={WINDOWS_GUIDE} url={downloads.windows} platform="Windows" />
          </Tabs.Content>
          <Tabs.Content value="macos">
            <Option guide={MACOS_GUIDE} url={downloads.macos} platform="macOS" />
          </Tabs.Content>
          <Tabs.Content value="linux">
            <LinuxOptions downloads={downloads} />
          </Tabs.Content>
        </Flex>
      </Tabs.Root>

      <Flex direction="column" gap="2">
        <Heading size="3" as="h2">
          Then connect it
        </Heading>
        <Text size="2" color="gray">
          Open the app, enter this server address and press Connect, then approve it in your
          browser. Or press Open VTT Chat below: it hands your sign-in to the app in one click.
        </Text>
        <Code size="3" className="connect-code">
          {window.location.origin}
        </Code>
        <ConnectApp server={window.location.origin} />
        <Text size="1" color="gray">
          Something not working? The <Link href={INSTALL_GUIDE_URL}>full install guide</Link> covers
          the tray icon, the AppImage menu entry and more.
        </Text>
      </Flex>
    </Flex>
  );
}

/**
 * The page to send a new player to: one tab per operating system, each with its own words and its own
 * download button, then what to do after installing. The tab opens on the visitor's own system.
 * Downloads are for signed-in accounts, so a visitor without a session is asked to sign in first; the
 * session cookie is reused, so coming here from the home page
 * needs no second sign-in. The home page passes `onBack` to show this inline in the same tab.
 */
export function DownloadPage({ onBack }: { onBack?: () => void }) {
  const { signedIn, checked, onSignedIn } = useSession();

  if (onBack && signedIn) return <DownloadContent onBack={onBack} />;
  return (
    <Card size="4">
      {signedIn ? (
        <DownloadContent />
      ) : !checked ? null : (
        <Flex direction="column" gap="3">
          <Heading size="6">Get VTT Chat</Heading>
          <Text size="2" color="gray">
            Sign in to download the app.
          </Text>
          <LoginForm onSignedIn={onSignedIn} />
        </Flex>
      )}
    </Card>
  );
}
