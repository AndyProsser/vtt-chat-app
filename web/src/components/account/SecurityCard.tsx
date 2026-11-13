import { Badge, Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useState } from 'react';

import { MIN_PASSWORD_LENGTH } from '../../consts/index.js';
import { changePassword, passwordDoneLine, passwordProblem } from '../../lib/account.js';
import { ApiError } from '../../lib/api.js';

/** Set or change the password. The server signs out every other device when it changes. */
export function SecurityCard({
  hasPassword,
  onChanged,
}: {
  hasPassword: boolean;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  async function submit() {
    const problem = passwordProblem({ hasPassword, current, next, confirm });
    setDone(undefined);
    if (problem) return setError(problem);
    setError(undefined);
    setBusy(true);
    try {
      const { revoked } = await changePassword({
        ...(hasPassword ? { currentPassword: current } : {}),
        newPassword: next,
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(passwordDoneLine(revoked, hasPassword));
      onChanged();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? 'That is not your current password.'
          : e instanceof ApiError
            ? e.message
            : 'Could not change the password. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    autoComplete: string,
  ) => (
    <Flex direction="column" gap="1">
      <Text as="label" size="2" weight="medium" htmlFor={id}>
        {label}
      </Text>
      <TextField.Root
        id={id}
        size="3"
        type="password"
        value={value}
        autoComplete={autoComplete}
        maxLength={512}
        onChange={(e) => set(e.target.value)}
      />
    </Flex>
  );

  return (
    <Card size="3" aria-labelledby="account-security">
      <Flex direction="column" gap="4">
        <Flex align="center" gap="2" justify="between" wrap="wrap">
          <Heading size="4" as="h2" id="account-security">
            Security
          </Heading>
          <Badge color={hasPassword ? 'green' : 'gray'} variant="soft">
            {hasPassword ? 'Password set' : 'No password'}
          </Badge>
        </Flex>
        <Text size="2" color="gray">
          {hasPassword
            ? 'Change your password here. Your other devices are signed out when you do; this one stays signed in.'
            : 'You sign in with emailed or operator codes. You can also set a password, so you can sign in without a code.'}
        </Text>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Flex direction="column" gap="3">
            {hasPassword &&
              field('account-current', 'Current password', current, setCurrent, 'current-password')}
            {field(
              'account-new',
              `New password (at least ${MIN_PASSWORD_LENGTH} characters)`,
              next,
              setNext,
              'new-password',
            )}
            {field(
              'account-confirm',
              'Repeat the new password',
              confirm,
              setConfirm,
              'new-password',
            )}
            <Flex>
              <Button type="submit" size="3" loading={busy}>
                {hasPassword ? 'Change password' : 'Set password'}
              </Button>
            </Flex>
          </Flex>
        </form>
        <div aria-live="polite">
          {error && (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          {done && !error && (
            <Text size="2" color="green">
              {done}
            </Text>
          )}
        </div>
      </Flex>
    </Card>
  );
}
