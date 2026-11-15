import { Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useState, type ReactNode } from 'react';

import { useEmailToken } from '../hooks/useEmailToken.js';
import { ApiError, redeemEmailCode, redeemResetLink } from '../lib/api.js';
import { ConsentStep } from './ConsentStep.js';

const EXPIRED = 'This link has expired or was already used. Ask for a new one.';
const MISSING = 'This link is incomplete. Open it again from your email, or ask for a new one.';

/**
 * Where an emailed sign-in or reset link lands. The token is redeemed only when the button is pressed, so
 * a mail scanner or chat preview that merely opens the link cannot use it up. Signing in goes through the
 * web, like every other sign-in: the desktop app is connected from here afterwards.
 */
export function EmailLinkPage({ kind }: { kind: 'signin' | 'reset' }) {
  const token = useEmailToken();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [needsConsent, setNeedsConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const reset = kind === 'reset';

  const goHome = () => window.location.assign('/');
  const mismatch = reset && again !== '' && again !== password;

  async function submit() {
    if (!token) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = reset ? await redeemResetLink(token, password) : await redeemEmailCode(token);
      if (result.needsConsent) setNeedsConsent(true);
      else goHome();
    } catch (e) {
      const api = e instanceof ApiError ? e : undefined;
      if (api?.code === 'invalid_token') setExpired(true);
      else setError(api?.message ?? 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  let body: ReactNode;
  if (needsConsent) {
    body = <ConsentStep onAccepted={goHome} />;
  } else if (!token || expired) {
    body = (
      <Flex direction="column" gap="3">
        <Callout.Root color="orange">
          <Callout.Text>{expired ? EXPIRED : MISSING}</Callout.Text>
        </Callout.Root>
        <Button size="3" onClick={goHome}>
          Back to sign in
        </Button>
      </Flex>
    );
  } else {
    body = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) void submit();
        }}
      >
        <Flex direction="column" gap="3">
          <Text color="gray">
            {reset
              ? 'Choose a new password. You will be signed in, and signed out everywhere else.'
              : 'Press the button to finish signing in.'}
          </Text>
          {reset && (
            <>
              <TextField.Root
                size="3"
                type="password"
                autoComplete="new-password"
                aria-label="New password"
                placeholder="New password (at least 10 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <TextField.Root
                size="3"
                type="password"
                autoComplete="new-password"
                aria-label="New password again"
                placeholder="New password again"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
              {mismatch && (
                <Text size="2" color="red">
                  The two passwords don’t match.
                </Text>
              )}
            </>
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
            disabled={reset && (password === '' || password !== again)}
          >
            {reset ? 'Set password and sign in' : 'Sign in'}
          </Button>
        </Flex>
      </form>
    );
  }

  return (
    <Flex direction="column" gap="4" className="join-shell">
      <Card className="join-card" size="4">
        <Flex direction="column" gap="4">
          <Heading size="5">{reset ? 'Reset your password' : 'Sign in to VTT Chat'}</Heading>
          {body}
        </Flex>
      </Card>
    </Flex>
  );
}
