import {
  blankDraft,
  createByHand,
  createFromSheet,
  type NewCharacterApi,
} from '@vtt-chat-app/shared';
import { Card, Flex, Text, TextField } from '@radix-ui/themes';
import { useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { addCharacter } from '../../lib/phone/phoneApi.js';
import { DdbLinkField } from './DdbLinkField.js';
import { IconTool } from './IconTool.js';

const api = (campaignId: string): NewCharacterApi => ({
  create: async (fields) => (await addCharacter(campaignId, fields)).character.id,
});

/**
 * Adding a character. With the D&D Beyond sync on, it starts from a pasted sheet link (name, race, class, level and
 * picture all come from the sheet) and a button switches to filling it in by hand; with the sync off, or when
 * D&D Beyond could not be read, the form is the way. The server reads the sheet before it makes anything, so a link
 * that fails leaves nothing behind.
 */
export function NewCharacter({
  campaignId,
  ddbOn,
  onDone,
  onCancel,
}: {
  campaignId: string;
  ddbOn: boolean | undefined;
  onDone: (createdId?: string) => void;
  onCancel: (() => void) | undefined;
}) {
  const [byHand, setByHand] = useState(false);
  const [draft, setDraft] = useState(blankDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fromSheet = ddbOn === true && !byHand;

  const attempt = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(undefined);
    try {
      onDone(await work());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not do that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const importSheet = (url: string) => attempt(() => createFromSheet(api(campaignId), url));

  const addByHand = () => attempt(() => createByHand(api(campaignId), draft));

  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Text size="4" weight="medium">
          New character
        </Text>
        {ddbOn === undefined ? null : fromSheet ? (
          <>
            <DdbLinkField busy={busy} action="Import" onLink={importSheet} />
            <Flex gap="2" wrap="wrap">
              <IconTool
                label="Fill in the details by hand instead"
                text="By hand"
                icon="pencil"
                onClick={() => setByHand(true)}
              />
              {onCancel && <IconTool label="Cancel" icon="x" onClick={onCancel} />}
            </Flex>
          </>
        ) : (
          <>
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
              You can add a picture once it is saved.
            </Text>
            <Flex gap="2" wrap="wrap">
              <IconTool
                label="Add the character"
                text="Add"
                icon="check"
                disabled={busy || draft.name.trim() === ''}
                onClick={() => void addByHand()}
              />
              {ddbOn && (
                <IconTool
                  label="Import from a D&D Beyond sheet instead"
                  text="D&D Beyond"
                  icon="link"
                  onClick={() => setByHand(false)}
                />
              )}
              {onCancel && <IconTool label="Cancel" icon="x" onClick={onCancel} />}
            </Flex>
          </>
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
