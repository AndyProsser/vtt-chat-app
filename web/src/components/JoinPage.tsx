import { Box, Callout, Card, Flex, Heading, Link, Spinner, Text } from '@radix-ui/themes';
import { useState } from 'react';

import posterJoin from '../assets/poster-join.webp';
import { useSession } from '../hooks/useSession.js';
import { useInvite } from '../hooks/useInvite.js';
import { codeFromPath } from '../lib/platform.js';
import { AccountForm } from './AccountForm.js';
import { Banner } from './Banner.js';
import { CodeEntry } from './CodeEntry.js';
import { GetTheApp } from './GetTheApp.js';

/**
 * The only browser UI: someone with an invite creates (or signs in to) an account, joins the
 * campaign, and is shown where to get the app. After install everything happens in the app.
 */
export function JoinPage() {
  const [code, setCode] = useState(() => codeFromPath(window.location.pathname));
  const session = useSession();
  const [joined, setJoined] = useState(false);
  // only the session this page just joined with; signing out (or a refused cookie) returns to the form
  const done = joined && session.signedIn;
  const state = useInvite(code);

  return (
    <Flex className="join-shell" direction="column" gap="4">
      <Banner src={posterJoin}>
        <Heading size="5">Join your table</Heading>
      </Banner>
      <Card className="join-card" size="4">
        <Flex direction="column" gap="4">
          {code === undefined ? (
            <CodeEntry onSubmit={setCode} />
          ) : state.status === 'loading' ? (
            <Flex justify="center" p="4">
              <Spinner size="3" />
            </Flex>
          ) : state.status === 'invalid' ? (
            <Callout.Root color="red">
              <Callout.Text>
                This invite code isn&apos;t valid, or has expired. Ask your DM for a new one. Have a
                sign-in code instead? Go to the <Link href="/">home page</Link> and choose Sign in.
              </Callout.Text>
            </Callout.Root>
          ) : state.status === 'error' ? (
            <Callout.Root color="orange">
              <Callout.Text>{state.message}</Callout.Text>
            </Callout.Root>
          ) : done ? (
            <GetTheApp campaignName={state.invite.campaignName} />
          ) : (
            <Box>
              <Text as="p" mb="3" color="gray">
                You&apos;ve been invited to <strong>{state.invite.campaignName}</strong>.
              </Text>
              <AccountForm
                code={code}
                consentVersion={state.invite.consentVersion}
                onJoined={() => {
                  setJoined(true);
                  session.onSignedIn();
                }}
              />
            </Box>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
