import { Button } from '@radix-ui/themes';

import { useSession } from '../hooks/useSession.js';

/** Ends the browser session on the server and forgets it in this tab; every signed-in view offers it. */
export function SignOutButton() {
  const { signOut } = useSession();
  return (
    <Button variant="ghost" color="gray" size="1" onClick={signOut}>
      Sign out
    </Button>
  );
}
