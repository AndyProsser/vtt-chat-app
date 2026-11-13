import { Card, Flex, Heading, Spinner, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useLoad } from '../../hooks/useLoad.js';
import { useSession } from '../../hooks/useSession.js';
import { loadAccount, loadSessions } from '../../lib/account.js';
import type { AccountUser } from '../../types/index.js';
import { LoginForm } from '../LoginForm.js';
import { DevicesCard } from './DevicesCard.js';
import { NoticeCard } from './NoticeCard.js';
import { ProfileCard } from './ProfileCard.js';
import { SecurityCard } from './SecurityCard.js';

function AccountContent() {
  const me = useLoad(loadAccount, 'me');
  const sessions = useLoad(loadSessions, 'sessions');
  // A profile save returns the new account; show it at once instead of waiting for a reload.
  const [edited, setEdited] = useState<AccountUser>();
  const user = edited ?? me.data?.user;

  if (!user) {
    return me.error ? (
      <Text color="orange" role="alert">
        {me.error}
      </Text>
    ) : (
      <Flex justify="center" p="4">
        <Spinner size="3" />
      </Flex>
    );
  }
  return (
    <Flex direction="column" gap="4">
      <Heading size="6" as="h1">
        Your account
      </Heading>
      <ProfileCard key={user.id} user={user} onChanged={setEdited} />
      <NoticeCard user={user} />
      <SecurityCard
        hasPassword={user.hasPassword === true}
        onChanged={() => {
          me.reload();
          setEdited(undefined);
          sessions.reload();
        }}
      />
      <DevicesCard
        sessions={sessions.data?.sessions}
        loading={sessions.loading}
        error={sessions.error}
        onChanged={sessions.reload}
      />
    </Flex>
  );
}

/** `/account`: profile, password, signed-in devices and the recording notice. Signed out, it shows the sign-in form. */
export function AccountPage() {
  const { signedIn, checked, onSignedIn } = useSession();
  if (!checked) return null;
  if (signedIn) return <AccountContent />;
  return (
    <Card size="4">
      <Flex direction="column" gap="3">
        <Heading size="6">Your account</Heading>
        <Text size="2" color="gray">
          Sign in to manage your profile, password and devices.
        </Text>
        <LoginForm onSignedIn={onSignedIn} />
      </Flex>
    </Card>
  );
}
