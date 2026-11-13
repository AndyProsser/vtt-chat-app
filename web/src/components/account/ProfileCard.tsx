import { Avatar, Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useRef, useState } from 'react';

import {
  avatarSrc,
  isEmblem,
  renameAccount,
  setAvatar,
  shrinkAvatar,
  uploadAvatar,
} from '../../lib/account.js';
import { ApiError } from '../../lib/api.js';
import { initials } from '../../lib/phone/rail.js';
import type { AccountUser } from '../../types/index.js';

const message = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.message : fallback;

/** Display name and portrait. The portrait is cropped to a small square here before it is uploaded. */
export function ProfileCard({
  user,
  onChanged,
}: {
  user: AccountUser;
  onChanged: (user: AccountUser) => void;
}) {
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState<'name' | 'picture' | undefined>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const src = avatarSrc(user.avatarUrl);
  const trimmed = name.trim();
  const unchanged = trimmed === user.displayName;

  async function run(kind: 'name' | 'picture', work: () => Promise<AccountUser>, done: string) {
    setBusy(kind);
    setError(undefined);
    setSaved(undefined);
    try {
      onChanged(await work());
      setSaved(done);
    } catch (e) {
      setError(message(e, 'Could not save that. Try again.'));
    } finally {
      setBusy(undefined);
    }
  }

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    void run(
      'picture',
      async () => {
        const blob = await shrinkAvatar(picked).catch(() => {
          throw new ApiError('invalid_input', 'That file is not a picture we can use.', 400);
        });
        const id = await uploadAvatar(blob);
        return (await setAvatar(`avatar:${id}`)).user;
      },
      'Picture updated.',
    );
    if (file.current) file.current.value = '';
  };

  return (
    <Card size="3" aria-labelledby="account-profile">
      <Flex direction="column" gap="4">
        <Heading size="4" as="h2" id="account-profile">
          Profile
        </Heading>

        <Flex align="center" gap="4" wrap="wrap">
          <Avatar
            size="6"
            radius="full"
            {...(src ? { src } : {})}
            fallback={initials(user.displayName)}
            alt=""
          />
          <Flex direction="column" gap="2">
            <Flex gap="2" wrap="wrap">
              <Button
                variant="soft"
                loading={busy === 'picture'}
                disabled={busy !== undefined}
                onClick={() => file.current?.click()}
              >
                {src ? 'Change picture' : 'Add a picture'}
              </Button>
              {user.avatarUrl && (
                <Button
                  variant="soft"
                  color="gray"
                  disabled={busy !== undefined}
                  onClick={() =>
                    void run(
                      'picture',
                      async () => (await setAvatar(null)).user,
                      'Picture removed.',
                    )
                  }
                >
                  Remove
                </Button>
              )}
            </Flex>
            {isEmblem(user.avatarUrl) && (
              <Text size="1" color="gray">
                Your picture is an emblem chosen in the desktop app; the web shows your initials.
              </Text>
            )}
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              aria-label="Choose a picture"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </Flex>
        </Flex>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!unchanged && trimmed !== '') {
              void run('name', async () => (await renameAccount(trimmed)).user, 'Name saved.');
            }
          }}
        >
          <Flex direction="column" gap="2">
            <Text as="label" size="2" weight="medium" htmlFor="account-name">
              Display name
            </Text>
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                id="account-name"
                size="3"
                value={name}
                maxLength={80}
                autoComplete="name"
                style={{ flex: '1 1 12rem' }}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                type="submit"
                size="3"
                loading={busy === 'name'}
                disabled={busy !== undefined || unchanged || trimmed === ''}
              >
                Save
              </Button>
            </Flex>
            <Text size="1" color="gray">
              This is what the table sees. Your email ({user.email}) stays private to you and the
              server&apos;s operator.
            </Text>
          </Flex>
        </form>

        <div aria-live="polite">
          {error && (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          {saved && !error && (
            <Text size="2" color="green">
              {saved}
            </Text>
          )}
        </div>
      </Flex>
    </Card>
  );
}
