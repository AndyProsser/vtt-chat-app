import {
  abilityLine,
  characterPatch,
  draftOf,
  vitalsLine,
  type CharacterRecord,
} from '@vtt-chat-app/shared';
import { Avatar, Badge, Button, Card, Flex, Text, TextField } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';

import { avatarSrc, shrinkAvatar, uploadAvatar } from '../../lib/account.js';
import { ApiError } from '../../lib/api.js';
import { playCharacter, saveCharacter } from '../../lib/phone/phoneApi.js';
import { initials } from '../../lib/phone/rail.js';
import { DdbBox } from './DdbBox.js';

/** One of your characters in this table: what it is, a way to change it, play it, and link its D&D Beyond sheet. */
export function CharacterCard({
  campaignId,
  record,
  playing,
  canPlay,
  onChanged,
}: {
  campaignId: string;
  record: CharacterRecord;
  playing: boolean;
  /** The DM does not play a character here; theirs are kept for if they swap back. */
  canPlay: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(draftOf(record));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(draftOf(record)), [record]);
  const fromSheet = Boolean(record.sourceUrl);
  const patch = characterPatch(record, draft);
  const dirty = Object.keys(patch).length > 0;
  const src = avatarSrc(record.avatarUrl);
  const details = [record.race, record.className, record.level ? `level ${record.level}` : null]
    .filter(Boolean)
    .join(' · ');

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const pickPicture = (picked: File | undefined) => {
    if (!picked) return;
    void run(async () => {
      const blob = await shrinkAvatar(picked).catch(() => {
        throw new ApiError('invalid_input', 'That file is not a picture we can use.', 400);
      });
      await saveCharacter(campaignId, record.id, {
        avatarUrl: `avatar:${await uploadAvatar(blob)}`,
      });
    });
    if (file.current) file.current.value = '';
  };

  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          <Avatar
            size="4"
            radius="full"
            {...(src ? { src } : {})}
            fallback={initials(record.name)}
            alt=""
          />
          <Flex direction="column" style={{ minWidth: 0, flex: 1 }}>
            <Text weight="medium">{record.name}</Text>
            <Text size="2" color="gray">
              {details || 'No details yet'}
            </Text>
          </Flex>
          {playing && (
            <Badge color="violet" variant="soft">
              Playing
            </Badge>
          )}
        </Flex>
        {vitalsLine(record.sheet) && (
          <Text size="1" color="gray">
            {vitalsLine(record.sheet)}
            <br />
            {abilityLine(record.sheet)}
          </Text>
        )}
        <Flex gap="2" wrap="wrap">
          {canPlay && !playing && (
            <Button
              disabled={busy}
              onClick={() => void run(() => playCharacter(campaignId, record.id))}
            >
              Play this character
            </Button>
          )}
          <Button
            variant="soft"
            color="gray"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? 'Close' : 'Edit'}
          </Button>
        </Flex>
        {open && (
          <Flex direction="column" gap="3">
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                style={{ flex: 2, minWidth: 160 }}
                aria-label="Name"
                placeholder="Name"
                disabled={fromSheet}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <TextField.Root
                style={{ width: 80 }}
                aria-label="Level"
                placeholder="Level"
                inputMode="numeric"
                disabled={fromSheet}
                value={draft.level}
                onChange={(e) => setDraft({ ...draft, level: e.target.value })}
              />
            </Flex>
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                style={{ flex: 1, minWidth: 120 }}
                aria-label="Race"
                placeholder="Race"
                disabled={fromSheet}
                value={draft.race}
                onChange={(e) => setDraft({ ...draft, race: e.target.value })}
              />
              <TextField.Root
                style={{ flex: 1, minWidth: 120 }}
                aria-label="Class"
                placeholder="Class"
                disabled={fromSheet}
                value={draft.className}
                onChange={(e) => setDraft({ ...draft, className: e.target.value })}
              />
            </Flex>
            {fromSheet && (
              <Text size="2" color="gray">
                Name, level, race and class come from your D&amp;D Beyond sheet. Change them there,
                then press Sync; the picture stays yours.
              </Text>
            )}
            <Flex gap="2" wrap="wrap">
              <Button variant="soft" disabled={busy} onClick={() => file.current?.click()}>
                {src ? 'Change picture' : 'Add a picture'}
              </Button>
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                aria-label="Choose a picture"
                onChange={(e) => pickPicture(e.target.files?.[0])}
              />
              <Button
                disabled={busy || !dirty || draft.name.trim() === ''}
                onClick={() => void run(() => saveCharacter(campaignId, record.id, patch))}
              >
                Save changes
              </Button>
            </Flex>
            <DdbBox campaignId={campaignId} character={record} onChanged={onChanged} />
            {error && (
              <Text size="2" color="red" role="alert">
                {error}
              </Text>
            )}
          </Flex>
        )}
      </Flex>
    </Card>
  );
}
