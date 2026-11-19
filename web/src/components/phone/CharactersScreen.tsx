import { type CharacterRecord } from '@vtt-chat-app/shared';
import { Flex, Spinner, Text } from '@radix-ui/themes';
import { useCallback, useEffect, useState } from 'react';

import { ddbEnabled, myCharacters } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import { CharacterCard } from './CharacterCard.js';
import { CharacterSwitcher } from './CharacterSwitcher.js';
import { NewCharacter } from './NewCharacter.js';

/**
 * Your characters in this table: a row of portraits to look at each one (Activate on the card makes it the one you play), the selected
 * character's card, and a way to add another. Characters belong to one table; to use the same sheet in two tables,
 * add it in each.
 */
export function CharactersScreen({ campaignId }: { campaignId: string }) {
  const userId = usePhoneStore((s) => s.userId);
  const isDm = usePhoneStore((s) => s.campaigns.find((c) => c.id === campaignId)?.role === 'dm');
  const activeName = usePhoneStore(
    (s) => s.members.find((m) => m.userId === userId)?.character?.name,
  );
  const [list, setList] = useState<CharacterRecord[]>();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [ddbOn, setDdbOn] = useState<boolean>();

  const load = useCallback(async () => {
    try {
      setList((await myCharacters(campaignId)).characters);
      setError(undefined);
    } catch {
      setError('Could not load your characters.');
    }
  }, [campaignId]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    let current = true;
    ddbEnabled()
      .then((r) => current && setDdbOn(r.enabled))
      .catch(() => current && setDdbOn(false));
    return () => {
      current = false;
    };
  }, []);

  if (!list && !error) {
    return (
      <Flex justify="center" p="6">
        <Spinner size="3" />
      </Flex>
    );
  }
  const playingId = isDm ? undefined : list?.find((c) => c.name === activeName)?.id;
  const shown = list?.find((c) => c.id === (picked ?? playingId)) ?? list?.[0];

  // A tap only shows a character; switching who you play is the card's Activate button, after a confirmation.
  const choose = (c: CharacterRecord) => {
    setPicked(c.id);
    setAdding(false);
  };

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
      <CharacterSwitcher
        characters={list ?? []}
        shownId={adding ? undefined : shown?.id}
        playingId={playingId}
        adding={adding}
        onChoose={choose}
        onAdd={() => setAdding(true)}
      />
      {adding || list?.length === 0 ? (
        <NewCharacter
          campaignId={campaignId}
          ddbOn={ddbOn}
          onDone={(id) => {
            setAdding(false);
            if (id) setPicked(id);
            void load();
          }}
          onCancel={list?.length ? () => setAdding(false) : undefined}
        />
      ) : (
        shown && (
          <CharacterCard
            key={shown.id}
            campaignId={campaignId}
            record={shown}
            playing={!isDm && shown.id === playingId}
            canPlay={!isDm}
            ddbOn={ddbOn}
            onChanged={() => void load()}
          />
        )
      )}
    </Flex>
  );
}
