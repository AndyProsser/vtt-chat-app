import { Box, Callout, Card, Flex, Heading, Spinner, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useInvite } from '../hooks/useInvite.js';
import { codeFromPath } from '../lib/platform.js';
import { AccountForm } from './AccountForm.js';
import { CodeEntry } from './CodeEntry.js';
import { GetTheApp } from './GetTheApp.js';

/**
 * The only browser UI: someone with an invite creates (or signs in to) an account, joins the
 * campaign, and is shown where to get the app. After install everything happens in the app.
 */
export function JoinPage() {
  const [code, setCode] = useState(() => codeFromPath(window.location.pathname));
  const [token, setToken] = useState<string>();
  const state = useInvite(code);

  return (
    <Flex className="join-shell">
      <Card className="join-card" size="4">
        <Flex direction="column" gap="4">
          <Heading size="6">Join your table</Heading>
          {code === undefined ? (
            <CodeEntry onSubmit={setCode} />
          ) : state.status === 'loading' ? (
            <Flex justify="center" p="4">
              <Spinner size="3" />
            </Flex>
          ) : state.status === 'invalid' ? (
            <Callout.Root color="red">
              <Callout.Text>
                This invite isn&apos;t valid any more. Ask your DM for a new one.
              </Callout.Text>
            </Callout.Root>
          ) : state.status === 'error' ? (
            <Callout.Root color="orange">
              <Callout.Text>{state.message}</Callout.Text>
            </Callout.Root>
          ) : token !== undefined ? (
            <GetTheApp
              token={token}
              campaignName={state.invite.campaignName}
              downloads={state.invite.downloads}
            />
          ) : (
            <Box>
              <Text as="p" mb="3" color="gray">
                You&apos;ve been invited to <strong>{state.invite.campaignName}</strong>.
              </Text>
              <AccountForm
                code={code}
                consentVersion={state.invite.consentVersion}
                onJoined={setToken}
              />
            </Box>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
