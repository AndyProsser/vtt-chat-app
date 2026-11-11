import { Button, Callout, Checkbox, Flex, Text, TextField } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { CONSENT_TEXT } from '../consts/index.js';
import {
  acceptCurrentConsent,
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

/**
 * Sign in with a password, or (when the server can send mail) with an emailed code. If the recording
 * notice changed since the account last accepted it, it is shown and accepted here before
 * `onSignedIn`: the server refuses to approve a device (or issue a link code) until it is.
 */
export function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mail, setMail] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [haveCode, setHaveCode] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [needsConsent, setNeedsConsent] = useState(false);
  const [consent, setConsent] = useState(false);
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
      if (needsConsent) {
        await acceptCurrentConsent();
        onSignedIn();
        return;
      }
      const signedIn =
        codeSent || haveCode
          ? await redeemEmailCode(emailCode.trim())
          : await signInPlain(email, password);
      if (signedIn.needsConsent) setNeedsConsent(true);
      else onSignedIn();
    });

  if (needsConsent) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (consent) void submit();
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Flex direction="column" gap="3">
        {!haveCode && (
          <TextField.Root
            size="3"
            type="email"
            autoComplete="email"
            aria-label="Email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        {codeSent || haveCode ? (
          <TextField.Root
            size="3"
            autoComplete="one-time-code"
            aria-label={haveCode ? 'Sign-in code' : 'Code from your email'}
            placeholder={haveCode ? 'ABCD-EFGH' : 'Code from your email'}
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value)}
          />
        ) : (
          <TextField.Root
            size="3"
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
          disabled={
            codeSent || haveCode
              ? (!haveCode && !email.includes('@')) || emailCode.trim() === ''
              : !email.includes('@') || password === ''
          }
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
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setHaveCode(!haveCode);
            setError(undefined);
          }}
        >
          {haveCode ? 'Use email and password instead' : 'I have a sign-in code'}
        </Button>
        {codeSent && !haveCode && (
          <Text size="1" color="gray">
            If that email has an account, a code is on its way.
          </Text>
        )}
      </Flex>
    </form>
  );
}
