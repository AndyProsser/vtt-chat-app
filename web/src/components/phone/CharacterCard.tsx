import {
  characterDetails,
  characterPatch,
  draftOf,
  syncedLabel,
  type CharacterRecord,
} from '@vtt-chat-app/shared';
import { Avatar, Badge, Card, Flex, Text, TextField } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';

import { avatarSrc, shrinkAvatar, uploadAvatar } from '../../lib/account.js';
import { ApiError } from '../../lib/api.js';
import { ddbCall, playCharacter, saveCharacter } from '../../lib/phone/phoneApi.js';
import { initials } from '../../lib/phone/rail.js';
import { Icon } from '../icons/index.js';
import { CharacterStats } from './CharacterStats.js';
import { DdbLinkField } from './DdbLinkField.js';
import { IconTool } from './IconTool.js';

/**
 * One of your characters: the portrait and what it is, then (for a linked D&D Beyond character) its numbers as
 * tiles. A linked character has no text boxes, because the sheet owns its details and its picture; a hand-made one
 * has the form behind the pencil, a picture you choose, and a way to link a sheet.
 */
export function CharacterCard({
  campaignId,
  record,
  playing,
  canPlay,
  ddbOn,
  onChanged,
}: {
  campaignId: string;
  record: CharacterRecord;
  playing: boolean;
  /** The DM does not play a character here; theirs are kept for if they swap back. */
  canPlay: boolean;
  /** The server has the D&D Beyond sync switched on (undefined until it has answered). */
  ddbOn: boolean | undefined;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [draft, setDraft] = useState(draftOf(record));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(draftOf(record)), [record]);
  const linked = Boolean(record.sourceUrl);
  const patch = characterPatch(record, draft);
  const dirty = Object.keys(patch).length > 0;
  const src = avatarSrc(record.avatarUrl);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not do that. Try again.');
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

  const portrait = (
    <Avatar
      size="6"
      radius="full"
      {...(src ? { src } : {})}
      fallback={initials(record.name)}
      alt=""
    />
  );

  return (
    <Card size="2" className="phone-char">
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          {linked ? (
            <span className="phone-char-portrait">{portrait}</span>
          ) : (
            <button
              type="button"
              className="phone-char-portrait phone-char-portrait-edit"
              aria-label={src ? 'Change picture' : 'Add a picture'}
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              {portrait}
              <span className="phone-char-camera" aria-hidden>
                <Icon name="imagePlus" size={14} />
              </span>
            </button>
          )}
          <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
            <Text size="5" weight="medium" className="phone-char-name">
              {record.name}
            </Text>
            <Text size="2" color="gray">
              {characterDetails(record) || 'No details yet'}
            </Text>
            {linked && (
              <Text size="1" color="gray" className="phone-char-synced">
                <Icon name="link" size={12} /> D&amp;D Beyond ·{' '}
                {syncedLabel(record.syncedAt ?? null, Date.now())}
              </Text>
            )}
          </Flex>
          {playing && (
            <Badge color="violet" variant="soft">
              Playing
            </Badge>
          )}
        </Flex>

        {record.sheet && <CharacterStats sheet={record.sheet} />}

        <Flex gap="2" wrap="wrap" className="phone-actions">
          {canPlay && !playing && (
            <IconTool
              label="Play this character"
              text="Play"
              icon="play"
              disabled={busy}
              onClick={() => void run(() => playCharacter(campaignId, record.id))}
            />
          )}
          {linked ? (
            <>
              <IconTool
                label="Sync now from D&D Beyond"
                text="Sync"
                icon="refresh"
                disabled={busy}
                onClick={() => void run(() => ddbCall('sync', campaignId, record.id))}
              />
              <IconTool
                label="Unlink from D&D Beyond (keeps the character as it is)"
                icon="unlink"
                disabled={busy}
                onClick={() => void run(() => ddbCall('unlink', campaignId, record.id))}
              />
            </>
          ) : (
            <>
              <IconTool
                label={editing ? 'Close the editor' : 'Edit this character'}
                icon={editing ? 'x' : 'pencil'}
                onClick={() => setEditing((v) => !v)}
              />
              {src && (
                <IconTool
                  label="Remove the picture"
                  icon="trash"
                  danger
                  disabled={busy}
                  onClick={() =>
                    void run(() => saveCharacter(campaignId, record.id, { avatarUrl: null }))
                  }
                />
              )}
              {ddbOn && (
                <IconTool
                  label="Link a D&D Beyond sheet"
                  icon="link"
                  onClick={() => setLinking((v) => !v)}
                />
              )}
            </>
          )}
        </Flex>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          aria-label="Choose a picture"
          onChange={(e) => pickPicture(e.target.files?.[0])}
        />

        {!linked && ddbOn === false && editing && (
          <Text size="1" color="gray">
            Linking a D&amp;D Beyond sheet is switched off on this server (<code>DDB_SYNC=1</code>{' '}
            turns it on).
          </Text>
        )}
        {!linked && linking && (
          <DdbLinkField
            busy={busy}
            onLink={(url) =>
              run(async () => {
                await ddbCall('link', campaignId, record.id, url);
                setLinking(false);
                setEditing(false);
              })
            }
          />
        )}
        {!linked && editing && (
          <Flex direction="column" gap="2">
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                style={{ flex: 2, minWidth: 160 }}
                aria-label="Name"
                placeholder="Name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <TextField.Root
                style={{ width: 80 }}
                aria-label="Level"
                placeholder="Level"
                inputMode="numeric"
                value={draft.level}
                onChange={(e) => setDraft({ ...draft, level: e.target.value })}
              />
            </Flex>
            <Flex gap="2" wrap="wrap">
              <TextField.Root
                style={{ flex: 1, minWidth: 120 }}
                aria-label="Race"
                placeholder="Race"
                value={draft.race}
                onChange={(e) => setDraft({ ...draft, race: e.target.value })}
              />
              <TextField.Root
                style={{ flex: 1, minWidth: 120 }}
                aria-label="Class"
                placeholder="Class"
                value={draft.className}
                onChange={(e) => setDraft({ ...draft, className: e.target.value })}
              />
            </Flex>
            <div>
              <IconTool
                label="Save changes"
                text="Save"
                icon="check"
                disabled={busy || !dirty || draft.name.trim() === ''}
                onClick={() => void run(() => saveCharacter(campaignId, record.id, patch))}
              />
            </div>
          </Flex>
        )}
        {error && (
          <Text size="2" color="red" role="alert">
            {error}
          </Text>
        )}
      </Flex>
    </Card>
  );
}
