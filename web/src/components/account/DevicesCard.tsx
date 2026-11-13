import { Badge, Button, Callout, Card, Flex, Heading, Spinner, Text } from '@radix-ui/themes';
import { useState } from 'react';

import { useConfirmClick } from '../../hooks/useConfirmClick.js';
import {
  ago,
  orderSessions,
  revokeOtherSessions,
  revokeSession,
  sessionLabel,
} from '../../lib/account.js';
import { ApiError } from '../../lib/api.js';
import type { AccountSession } from '../../types/index.js';
import { SignOutButton } from '../SignOutButton.js';

/** Device text is the device's own words: shown as text in an isolated ltr span, never as markup. */
function Isolated({ children }: { children: string }) {
  return (
    <span dir="ltr" className="isolated">
      {children}
    </span>
  );
}

/** A two-press button: the first press arms it, the second does it. */
function ConfirmButton({
  label,
  armedLabel,
  busy,
  onConfirm,
  describedBy,
  ariaLabel,
}: {
  label: string;
  armedLabel: string;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
  describedBy?: string;
  ariaLabel?: string;
}) {
  const { armed, press } = useConfirmClick(onConfirm);
  return (
    <Button
      size="2"
      variant={armed ? 'solid' : 'soft'}
      color={armed ? 'red' : 'gray'}
      loading={busy}
      onClick={press}
      aria-label={armed ? `${armedLabel}: ${ariaLabel ?? label}` : (ariaLabel ?? label)}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
    >
      {armed ? armedLabel : label}
    </Button>
  );
}

function Row({
  session,
  now,
  children,
}: {
  session: AccountSession;
  now: number;
  children: React.ReactNode;
}) {
  const label = sessionLabel(session);
  return (
    <li className="account-device">
      <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="3" weight="medium" className="account-device-label">
            <Isolated>{label}</Isolated>
          </Text>
          {session.current && (
            <Badge color="violet" variant="soft">
              This device
            </Badge>
          )}
        </Flex>
        <Text size="1" color="gray">
          Signed in {ago(session.createdAt, now)} · last seen {ago(session.lastSeenAt, now)}
        </Text>
      </Flex>
      <div className="account-device-action">{children}</div>
    </li>
  );
}

/** Every device that is signed in to this account, with remote sign-out (confirm by a second press). */
export function DevicesCard({
  sessions,
  loading,
  error,
  onChanged,
}: {
  sessions: AccountSession[] | undefined;
  loading: boolean;
  error: string | undefined;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [note, setNote] = useState<string>();
  const now = Date.now();
  const { current, others } = orderSessions(sessions ?? []);

  async function run(id: string, work: () => Promise<string | undefined>) {
    setBusyId(id);
    setProblem(undefined);
    setNote(undefined);
    try {
      setNote(await work());
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not reach the server.');
    } finally {
      setBusyId(undefined);
      onChanged();
    }
  }

  return (
    <Card size="3" aria-labelledby="account-devices">
      <Flex direction="column" gap="4">
        <Heading size="4" as="h2" id="account-devices">
          Devices
        </Heading>
        <Text size="2" color="gray">
          Everywhere you are signed in. Sign out a device you no longer use or do not recognise; it
          has to sign in again.
        </Text>

        {loading && !sessions ? (
          <Flex justify="center" p="3">
            <Spinner size="3" />
          </Flex>
        ) : error && !sessions ? (
          <Callout.Root color="orange">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        ) : (
          <ul className="account-devices" aria-label="Signed-in devices">
            {current && (
              <Row session={current} now={now}>
                <SignOutButton />
              </Row>
            )}
            {others.map((s) => (
              <Row key={s.id} session={s} now={now}>
                <ConfirmButton
                  label="Sign out"
                  armedLabel="Press again to sign out"
                  ariaLabel={`Sign out ${sessionLabel(s)}`}
                  busy={busyId === s.id}
                  onConfirm={() =>
                    run(s.id, async () => {
                      await revokeSession(s.id);
                      return 'Device signed out.';
                    })
                  }
                />
              </Row>
            ))}
            {others.length === 0 && (
              <li>
                <Text size="2" color="gray">
                  No other devices are signed in.
                </Text>
              </li>
            )}
          </ul>
        )}

        {others.length > 0 && (
          <Flex>
            <ConfirmButton
              label="Sign out all other devices"
              armedLabel="Press again to sign out all other devices"
              busy={busyId === 'all'}
              onConfirm={() =>
                run('all', async () => {
                  const { revoked } = await revokeOtherSessions();
                  return `${revoked} other ${revoked === 1 ? 'device' : 'devices'} signed out.`;
                })
              }
            />
          </Flex>
        )}

        <div aria-live="polite">
          {problem && (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{problem}</Callout.Text>
            </Callout.Root>
          )}
          {note && !problem && (
            <Text size="2" color="green">
              {note}
            </Text>
          )}
        </div>
      </Flex>
    </Card>
  );
}
