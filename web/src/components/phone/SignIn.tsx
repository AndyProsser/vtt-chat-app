import {
  Button,
  Callout,
  Checkbox,
  Flex,
  Heading,
  SegmentedControl,
  Text,
  TextField,
} from '@radix-ui/themes';
import { useState } from 'react';

import { CONSENT_TEXT } from '../../consts/index.js';
import { SIGN_IN_MESSAGES } from '../../consts/phone.js';
import { ApiError } from '../../lib/api.js';
import { acceptConsent, login, providers, redeemCode } from '../../lib/phone/phoneApi.js';

type Mode = 'password' | 'code';

/** Email and password, or a one-time code. A changed recording notice is accepted here once. */
export function SignIn({
  onSignedIn,
  notice,
  initialPending,
}: {
  onSignedIn: (userId?: string) => void;
  /** Shown above the form, e.g. why a hand-off link did not sign you in. */
  notice?: string;
  /** A session already issued (by a hand-off link) that only needs the changed recording notice accepted. */
  initialPending?: { userId?: string };
}) {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<{ userId?: string } | undefined>(initialPending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      if (pending) {
        const { consentVersion } = await providers();
        await acceptConsent(consentVersion);
        onSignedIn(pending.userId);
        return;
      }
      const res = mode === 'password' ? await login(email, password) : await redeemCode(code);
      if (!res.signedIn) throw new ApiError('no_session', 'The server did not sign you in.', 500);
      if (res.needsConsent) setPending(res.user?.id ? { userId: res.user.id } : {});
      else onSignedIn(res.user?.id);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (SIGN_IN_MESSAGES[e.code] ?? e.message)
          : 'Could not reach the server. Check your connection.',
      );
    } finally {
      setBusy(false);
    }
  }

  const ready = pending
    ? consent
    : mode === 'password'
      ? email.includes('@') && password !== ''
      : code.trim() !== '';

  return (
    <form
      className="phone-sign-in"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1">
          <Heading size="7">Your table</Heading>
          <Text color="gray">
            Read the chat, answer an invitation, open a handout or catch up on a session.
          </Text>
        </Flex>
        {notice && !pending && (
          <Callout.Root color="amber">
            <Callout.Text>{notice}</Callout.Text>
          </Callout.Root>
        )}
        {pending ? (
          <>
            <Callout.Root color="amber">
              <Callout.Text>
                The recording notice has changed. Please read it and accept to continue.
              </Callout.Text>
            </Callout.Root>
            <Text size="2">{CONSENT_TEXT}</Text>
            <Text as="label" size="2">
              <Flex gap="2" align="center">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />I
                accept the recording notice
              </Flex>
            </Text>
          </>
        ) : (
          <>
            <SegmentedControl.Root value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SegmentedControl.Item value="password">Password</SegmentedControl.Item>
              <SegmentedControl.Item value="code">One-time code</SegmentedControl.Item>
            </SegmentedControl.Root>
            {mode === 'password' ? (
              <>
                <TextField.Root
                  id="phone-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder="Email"
                  aria-label="Email"
                  size="3"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <TextField.Root
                  id="phone-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  aria-label="Password"
                  size="3"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </>
            ) : (
              <TextField.Root
                id="phone-code"
                autoComplete="one-time-code"
                placeholder="Code from your DM or the server"
                aria-label="One-time code"
                size="3"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </>
        )}
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Button size="3" type="submit" disabled={!ready} loading={busy}>
          {pending ? 'Accept and continue' : 'Sign in'}
        </Button>
      </Flex>
    </form>
  );
}
