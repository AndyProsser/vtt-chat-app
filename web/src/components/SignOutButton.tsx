import { Button, Flex, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useSession } from '../hooks/useSession.js';

/** Ends the browser session on the server and forgets it in this tab; every signed-in view offers it. */
export function SignOutButton() {
  const { signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const press = async () => {
    setBusy(true);
    setError(undefined);
    const result = await signOut();
    // On success the page flips to its signed-out view (this button unmounts); on a refusal it stays and says so.
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
    }
  };
  return (
    <Flex direction="column" align="center" gap="1">
      <Button variant="ghost" color="gray" size="1" disabled={busy} onClick={() => void press()}>
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
      {error && (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      )}
    </Flex>
  );
}
