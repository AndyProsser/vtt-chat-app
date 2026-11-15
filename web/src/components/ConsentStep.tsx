import { Button, Callout, Checkbox, Flex, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { CONSENT_TEXT } from '../consts/index.js';
import { acceptCurrentConsent, ApiError } from '../lib/api.js';

/**
 * The recording notice, when it changed since the account last accepted it. The server refuses to approve a
 * device (or issue a link code) until it is accepted, so every sign-in path ends here when needed.
 */
export function ConsentStep({ onAccepted }: { onAccepted: () => void }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function accept() {
    setBusy(true);
    setError(undefined);
    try {
      await acceptCurrentConsent();
      onAccepted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (consent) void accept();
      }}
    >
      <Flex direction="column" gap="3">
        <Callout.Root color="amber">
          <Callout.Text>Please read the recording notice and accept it to continue.</Callout.Text>
        </Callout.Root>
        <Text size="2">{CONSENT_TEXT}</Text>
        <Text as="label" size="2">
          <Flex gap="2" align="center">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />I accept
            the recording notice
          </Flex>
        </Text>
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Button type="submit" size="3" loading={busy} disabled={!consent}>
          Accept and continue
        </Button>
      </Flex>
    </form>
  );
}
