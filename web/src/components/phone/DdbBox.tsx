import { looksLikeSheetLink, syncedLabel, type CharacterRecord } from '@vtt-chat-app/shared';
import { Button, Flex, Text, TextField } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { ddbCall, ddbEnabled } from '../../lib/phone/phoneApi.js';

/**
 * Links a character to its public D&D Beyond sheet so its name, race, class, level and numbers follow it. When the
 * server's operator has not switched the sync on, it says so instead of hiding.
 */
export function DdbBox({
  campaignId,
  character,
  onChanged,
}: {
  campaignId: string;
  character: CharacterRecord;
  onChanged: (updated: CharacterRecord) => void;
}) {
  const [enabled, setEnabled] = useState<boolean>();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    ddbEnabled()
      .then((r) => current && setEnabled(r.enabled))
      .catch(() => current && setEnabled(false));
    return () => {
      current = false;
    };
  }, []);

  if (enabled === undefined) return null;
  if (!enabled) {
    return (
      <Text size="2" color="gray">
        Linking a D&amp;D Beyond sheet is switched off on this server. Ask whoever runs it to turn
        it on (<code>DDB_SYNC=1</code>).
      </Text>
    );
  }

  const run = async (action: 'link' | 'sync' | 'unlink', url?: string) => {
    setBusy(true);
    setError(undefined);
    try {
      onChanged((await ddbCall(action, campaignId, character.id, url)).character);
      setLink('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach D&D Beyond. Try again later.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">
        D&amp;D Beyond
      </Text>
      {character.sourceUrl ? (
        <>
          <Text size="2" color="gray">
            Linked to {character.sourceUrl.replace('https://www.', '')}.{' '}
            {syncedLabel(character.syncedAt ?? null, Date.now())}.
          </Text>
          <Flex gap="2" wrap="wrap">
            <Button variant="soft" disabled={busy} onClick={() => void run('sync')}>
              Sync now
            </Button>
            <Button variant="soft" color="gray" disabled={busy} onClick={() => void run('unlink')}>
              Unlink
            </Button>
          </Flex>
        </>
      ) : (
        <>
          <Text size="2" color="gray">
            Paste the link to your character&apos;s sheet (it must be shared publicly on D&amp;D
            Beyond).
          </Text>
          <Flex gap="2" wrap="wrap">
            <TextField.Root
              style={{ flex: 1, minWidth: 180 }}
              aria-label="D&D Beyond character link"
              placeholder="https://www.dndbeyond.com/characters/…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <Button
              disabled={busy || !looksLikeSheetLink(link)}
              onClick={() => void run('link', link.trim())}
            >
              Link
            </Button>
          </Flex>
        </>
      )}
      {error && (
        <Text size="2" color="red" role="alert">
          {error}
        </Text>
      )}
    </Flex>
  );
}
