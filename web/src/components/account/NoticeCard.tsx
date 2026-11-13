import { Card, Flex, Heading, Text } from '@radix-ui/themes';

import { noticeLine } from '../../lib/account.js';
import type { AccountUser } from '../../types/index.js';

/** The recording notice this account accepted. Read-only: accepting a new version happens at sign-in. */
export function NoticeCard({ user }: { user: AccountUser }) {
  return (
    <Card size="3" aria-labelledby="account-notice">
      <Flex direction="column" gap="2">
        <Heading size="4" as="h2" id="account-notice">
          Recording notice
        </Heading>
        <Text size="2">{noticeLine(user)}</Text>
        <Text size="1" color="gray">
          Sessions may be recorded. You hear a cue when one starts and a recording indicator stays
          visible. Whispers and private audio are never recorded. If the server&apos;s notice
          changes, you are asked to accept it again the next time you sign in.
        </Text>
      </Flex>
    </Card>
  );
}
