import { Button, Callout, Flex, Text, TextArea, TextField } from '@radix-ui/themes';
import { useState } from 'react';

import { ApiError, requestAccount } from '../lib/api.js';

const MESSAGES: Record<string, string> = {
  rate_limited: 'Too many requests from this address. Try again later.',
  not_found: 'This server is not taking account requests right now.',
  conflict: 'Too many requests are waiting. Try again later.',
};

/**
 * Ask the operator for an account. Nothing is created here: the operator approves in their admin
 * tool and passes a one-time sign-in code on by some other route, so the confirmation says only that
 * the request was sent (it is the same whether or not the address is already known).
 */
export function RequestAccount() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  if (sent) {
    return (
      <Callout.Root color="green" role="status">
        <Callout.Text>Request sent. The operator will approve it and send you a code.</Callout.Text>
      </Callout.Root>
    );
  }

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const note = message.trim();
      await requestAccount({
        email: email.trim(),
        displayName: name.trim(),
        ...(note ? { message: note } : {}),
      });
      setSent(true);
    } catch (e) {
      const api = e instanceof ApiError ? e : undefined;
      setError(MESSAGES[api?.code ?? ''] ?? api?.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Flex direction="column" gap="3">
        <Text size="2" color="gray">
          No invite? Ask the person who runs this server for an account.
        </Text>
        <TextField.Root
          size="3"
          autoComplete="name"
          aria-label="Your name"
          placeholder="Your name"
          maxLength={80}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField.Root
          size="3"
          type="email"
          autoComplete="email"
          aria-label="Email"
          placeholder="Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextArea
          size="3"
          aria-label="Message (optional)"
          placeholder="Who are you, and which group are you joining? (optional)"
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Button type="submit" size="3" loading={busy} style={{ width: '100%' }}>
          Request an account
        </Button>
      </Flex>
    </form>
  );
}
