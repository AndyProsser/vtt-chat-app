import { blankDraft, type CharacterRecord } from '@vtt-chat-app/shared';
import { Button, Card, Flex, Spinner, Text, TextField } from '@radix-ui/themes';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { addCharacter, myCharacters } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import { CharacterCard } from './CharacterCard.js';

/** Your characters in this table: add one, change one, choose who you play, link a D&D Beyond sheet. */
export function CharactersScreen({ campaignId }: { campaignId: string }) {
  const userId = usePhoneStore((s) => s.userId);
  const isDm = usePhoneStore((s) => s.campaigns.find((c) => c.id === campaignId)?.role === 'dm');
  const activeName = usePhoneStore(
    (s) => s.members.find((m) => m.userId === userId)?.character?.name,
  );
  const [list, setList] = useState<CharacterRecord[]>();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await myCharacters(campaignId)).characters);
      setError(undefined);
    } catch {
      setError('Could not load your characters.');
    }
  }, [campaignId]);
  useEffect(() => void load(), [load]);

  if (!list && !error) {
    return (
      <Flex justify="center" p="6">
        <Spinner size="3" />
      </Flex>
    );
  }
  return (
    <Flex direction="column" gap="3">
      <Text size="2" color="gray">
        Your characters in this table; other tables have their own.
        {isDm && ' As the DM you do not play one here; yours are kept for if you swap back.'}
      </Text>
      {error && (
        <Text color="red" role="alert">
          {error}
        </Text>
      )}
      {list?.length === 0 && !adding && <Text color="gray">No character yet.</Text>}
      {list?.map((c) => (
        <CharacterCard
          key={c.id}
          campaignId={campaignId}
          record={c}
          playing={!isDm && c.name === activeName}
          canPlay={!isDm}
          onChanged={() => void load()}
        />
      ))}
      {adding ? (
        <NewCharacter
          campaignId={campaignId}
          onDone={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setAdding(true)}>
            New character
          </Button>
        </div>
      )}
    </Flex>
  );
}

function NewCharacter({
  campaignId,
  onDone,
  onCancel,
}: {
  campaignId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(blankDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await addCharacter(campaignId, {
        name: draft.name.trim(),
        className: draft.className.trim() || null,
        race: draft.race.trim() || null,
        level: /^\d+$/.test(draft.level) ? Number(draft.level) : null,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add that. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Text weight="medium">New character</Text>
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
        <Text size="2" color="gray">
          You can link a D&amp;D Beyond sheet and add a picture once it is saved.
        </Text>
        <Flex gap="2">
          <Button disabled={busy || draft.name.trim() === ''} onClick={() => void save()}>
            Add
          </Button>
          <Button variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
        </Flex>
        {error && (
          <Text size="2" color="red" role="alert">
            {error}
          </Text>
        )}
      </Flex>
    </Card>
  );
}
