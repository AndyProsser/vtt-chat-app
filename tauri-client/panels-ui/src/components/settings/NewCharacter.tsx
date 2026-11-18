import {
  blankDraft,
  createByHand,
  createFromSheet,
  type NewCharacterApi,
} from '@vtt-chat-app/shared';
import { TextField } from '@radix-ui/themes';
import { Check, Link2, Pencil, X } from 'lucide-react';
import { useState } from 'react';

import { accountErrorMessage, campaignApi, ddbAction } from '../../lib/tauriBridge.js';
import { ToolButton } from '../ToolButton.js';
import { DdbLinkField } from './DdbLinkField.js';

const api: NewCharacterApi = {
  create: async (fields) =>
    (await campaignApi<{ character: { id: string } }>('POST', 'characters', fields)).character.id,
  update: (id, fields) => campaignApi('PATCH', `characters/${id}`, fields),
  link: (id, url) => ddbAction('link', id, url),
};

/**
 * Adding a character. With the D&D Beyond sync on, it starts from a pasted sheet link (name, race, class, level and
 * picture all come from the sheet) and a button switches to filling it in by hand; with the sync off, or when
 * D&D Beyond could not be read, the form is the way. The link is made after the character exists (the server has no
 * one-step route yet), so a link that fails leaves a plain character to fill in, never a half-made one.
 */
export function NewCharacter({
  ddbOn,
  onDone,
  onCancel,
}: {
  ddbOn: boolean | undefined;
  onDone: (createdId?: string) => void;
  onCancel: (() => void) | undefined;
}) {
  const [byHand, setByHand] = useState(false);
  const [draft, setDraft] = useState(blankDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Set once the character has been made, so trying again does not make a second one.
  const [madeId, setMadeId] = useState<string>();
  const fromSheet = ddbOn === true && !byHand;

  const attempt = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(undefined);
    try {
      onDone(await work());
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const importSheet = (url: string) => attempt(() => createFromSheet(api, url, madeId, setMadeId));

  const addByHand = () => attempt(() => createByHand(api, draft, madeId));

  return (
    <section className="vtt-session">
      <b>New character</b>
      {ddbOn === undefined ? null : fromSheet ? (
        <>
          <DdbLinkField busy={busy} action="Import" onLink={importSheet} />
          <div className="vtt-form-row">
            <ToolButton
              label="Fill in the details by hand instead"
              text="By hand"
              onClick={() => setByHand(true)}
            >
              <Pencil size={14} />
            </ToolButton>
            {onCancel && (
              <ToolButton label="Cancel" onClick={onCancel}>
                <X size={14} />
              </ToolButton>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="vtt-form-row">
            <TextField.Root
              size="1"
              style={{ flex: 1, minWidth: 120 }}
              aria-label="Name"
              placeholder="Name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <TextField.Root
              size="1"
              style={{ width: 60 }}
              aria-label="Level"
              placeholder="Lvl"
              inputMode="numeric"
              value={draft.level}
              onChange={(e) => setDraft({ ...draft, level: e.target.value })}
            />
          </div>
          <div className="vtt-form-row">
            <TextField.Root
              size="1"
              style={{ flex: 1, minWidth: 90 }}
              aria-label="Race"
              placeholder="Race"
              value={draft.race}
              onChange={(e) => setDraft({ ...draft, race: e.target.value })}
            />
            <TextField.Root
              size="1"
              style={{ flex: 1, minWidth: 90 }}
              aria-label="Class"
              placeholder="Class"
              value={draft.className}
              onChange={(e) => setDraft({ ...draft, className: e.target.value })}
            />
          </div>
          <span className="vtt-muted">You can add a picture once it is saved.</span>
          <div className="vtt-form-row">
            <ToolButton
              label="Add the character"
              text="Add"
              disabled={busy || draft.name.trim() === ''}
              onClick={() => void addByHand()}
            >
              <Check size={14} />
            </ToolButton>
            {ddbOn && (
              <ToolButton
                label="Import from a D&D Beyond sheet instead"
                text="D&D Beyond"
                onClick={() => setByHand(false)}
              >
                <Link2 size={14} />
              </ToolButton>
            )}
            {onCancel && (
              <ToolButton label="Cancel" onClick={onCancel}>
                <X size={14} />
              </ToolButton>
            )}
          </div>
        </>
      )}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </section>
  );
}
