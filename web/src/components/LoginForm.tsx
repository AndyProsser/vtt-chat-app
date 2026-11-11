import { Button, Callout, Flex, Text, TextField } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import {
  ApiError,
  emailSignInCode,
  mailAvailable,
  redeemEmailCode,
  signInPlain,
} from '../lib/api.js';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match.',
  invalid_token: 'That code isn’t right or has expired.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
};

/** Sign in with a password, or (when the server can send mail) with an emailed code. */
export function LoginForm({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mail, setMail] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void mailAvailable().then(setMail);
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      const api = e instanceof ApiError ? e : undefined;
      setError(MESSAGES[api?.code ?? ''] ?? api?.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const submit = () =>
    run(async () => {
      onSignedIn(
        codeSent ? await redeemEmailCode(emailCode.trim()) : await signInPlain(email, password),
      );
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Flex direction="column" gap="3">
        <TextField.Root
          type="email"
          autoComplete="email"
          aria-label="Email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {codeSent ? (
          <TextField.Root
            autoComplete="one-time-code"
            aria-label="Code from your email"
            placeholder="Code from your email"
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value)}
          />
        ) : (
          <TextField.Root
            type="password"
            autoComplete="current-password"
            aria-label="Password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Button
          type="submit"
          size="3"
          loading={busy}
          disabled={!email.includes('@') || (codeSent ? emailCode.trim() === '' : password === '')}
        >
          Sign in
        </Button>
        {mail && !codeSent && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || !email.includes('@')}
            onClick={() =>
              void run(async () => {
                await emailSignInCode(email);
                setCodeSent(true);
              })
            }
          >
            Email me a code instead
          </Button>
        )}
        {codeSent && (
          <Text size="1" color="gray">
            If that email has an account, a code is on its way.
          </Text>
        )}
      </Flex>
    </form>
  );
}
