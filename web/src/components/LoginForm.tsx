import { Button, Callout, Flex, Text, TextField } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import {
  ApiError,
  emailResetLink,
  emailSignInLink,
  mailAvailable,
  redeemEmailCode,
  signInPlain,
} from '../lib/api.js';
import { ConsentStep } from './ConsentStep.js';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match.',
  invalid_token: 'That code isn’t right or has expired.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
};

/**
 * Sign in with a password. When the server can send mail the person may instead be emailed a sign-in link,
 * or a link to reset a forgotten password; both open the web app (`EmailLinkPage`). "I have a sign-in code"
 * is for a code someone read out to them (the DM, the operator). If the recording notice changed since the
 * account last accepted it, it is shown and accepted here before `onSignedIn`.
 */
export function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mail, setMail] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [haveCode, setHaveCode] = useState(false);
  const [code, setCode] = useState('');
  const [needsConsent, setNeedsConsent] = useState(false);
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
      const signedIn = haveCode
        ? await redeemEmailCode(code.trim())
        : await signInPlain(email, password);
      if (signedIn.needsConsent) setNeedsConsent(true);
      else onSignedIn();
    });

  const sendLink = (send: (email: string) => Promise<unknown>) =>
    run(async () => {
      await send(email);
      setNotice('If that email has an account, a link is on its way. It can take a minute.');
    });

  if (needsConsent) return <ConsentStep onAccepted={onSignedIn} />;

  const validEmail = email.includes('@');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Flex direction="column" gap="3">
        {haveCode ? (
          <TextField.Root
            size="3"
            autoComplete="one-time-code"
            aria-label="Sign-in code"
            placeholder="ABCD-EFGH"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        ) : (
          <>
            <TextField.Root
              size="3"
              type="email"
              autoComplete="email"
              aria-label="Email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField.Root
              size="3"
              type="password"
              autoComplete="current-password"
              aria-label="Password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        {notice && (
          <Callout.Root color="green" role="status">
            <Callout.Text>{notice}</Callout.Text>
          </Callout.Root>
        )}
        <Button
          type="submit"
          size="3"
          loading={busy}
          disabled={haveCode ? code.trim() === '' : !validEmail || password === ''}
        >
          Sign in
        </Button>
        {mail && !haveCode && (
          <Flex direction="column" gap="1" align="center">
            <Text size="1" color="gray">
              Type your email above, then:
            </Text>
            <Flex gap="3" wrap="wrap" justify="center">
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !validEmail}
                onClick={() => void sendLink(emailSignInLink)}
              >
                Email me a sign-in link
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !validEmail}
                onClick={() => void sendLink(emailResetLink)}
              >
                Forgot password?
              </Button>
            </Flex>
          </Flex>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setHaveCode(!haveCode);
            setError(undefined);
            setNotice(undefined);
          }}
        >
          {haveCode ? 'Use email and password instead' : 'I have a sign-in code'}
        </Button>
      </Flex>
    </form>
  );
}
