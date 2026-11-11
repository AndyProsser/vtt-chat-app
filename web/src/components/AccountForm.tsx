import {
  Button,
  Callout,
  Checkbox,
  Flex,
  SegmentedControl,
  Text,
  TextField,
} from '@radix-ui/themes';
import { useState } from 'react';

import { CONSENT_TEXT, MIN_PASSWORD_LENGTH } from '../consts/index.js';
import { ApiError, joinCampaign, signIn, signOut, signUp } from '../lib/api.js';

type Mode = 'create' | 'signin';

const MESSAGES: Record<string, string> = {
  email_taken: 'That email already has an account — switch to “I have an account”.',
  invalid_credentials: 'That email and password don’t match.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  invite_invalid: 'This invite isn’t valid any more. Ask your DM for a new one.',
};

export function AccountForm(props: {
  code: string;
  consentVersion: string;
  onJoined: (token: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('create');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const creating = mode === 'create';
  const problem = !email.includes('@')
    ? 'Enter your email.'
    : creating && displayName.trim() === ''
      ? 'Choose a display name.'
      : creating && password.length < MIN_PASSWORD_LENGTH
        ? `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`
        : !creating && password === ''
          ? 'Enter your password.'
          : !consent
            ? 'Please accept the recording notice.'
            : undefined;

  async function submit() {
    if (problem) return;
    setBusy(true);
    setError(undefined);
    try {
      const token = creating
        ? await signUp({
            email,
            displayName: displayName.trim(),
            password,
            consentVersion: props.consentVersion,
          })
        : await signIn(email, password, props.consentVersion);
      try {
        await joinCampaign(token, props.code);
      } catch (e) {
        await signOut(token);
        throw e;
      }
      props.onJoined(token);
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
        <SegmentedControl.Root value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <SegmentedControl.Item value="create">Create account</SegmentedControl.Item>
          <SegmentedControl.Item value="signin">I have an account</SegmentedControl.Item>
        </SegmentedControl.Root>

        <TextField.Root
          type="email"
          autoComplete="email"
          aria-label="Email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {creating && (
          <TextField.Root
            autoComplete="nickname"
            aria-label="Display name"
            placeholder="Display name (what your table sees)"
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}
        <TextField.Root
          type="password"
          autoComplete={creating ? 'new-password' : 'current-password'}
          aria-label="Password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Text as="label" size="2" color="gray">
          <Flex gap="2" align="start">
            <Checkbox checked={consent} onCheckedChange={(c) => setConsent(c === true)} mt="1" />
            <span>{CONSENT_TEXT}</span>
          </Flex>
        </Text>

        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Button type="submit" size="3" loading={busy} disabled={problem !== undefined}>
          {creating ? 'Create account and join' : 'Sign in and join'}
        </Button>
        {problem && (
          <Text size="1" color="gray">
            {problem}
          </Text>
        )}
      </Flex>
    </form>
  );
}
