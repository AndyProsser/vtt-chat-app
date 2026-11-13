import { Button, Callout, Flex, Switch, Text, TextField } from '@radix-ui/themes';
import { useId, useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { counter, NOTE_LIMITS, validateNote } from '../../lib/phone/noteForm.js';
import { createNote, showHandout, updateNote } from '../../lib/phone/phoneApi.js';
import type { HandoutItem } from '../../types/phone.js';
import { MarkdownField } from './MarkdownField.js';
import { Sheet } from './Sheet.js';

/**
 * Write a note, or change one. A new note is a draft only the DM can see (as on the desktop) unless the
 * DM chooses to show it now, which also puts a card in the table chat.
 */
export function NoteEditor({
  campaignId,
  note,
  onDone,
  onCancel,
}: {
  campaignId: string;
  /** The note being changed; none when writing a new one. */
  note?: HandoutItem;
  onDone: (saved?: HandoutItem) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [tried, setTried] = useState(false);

  const { errors, payload } = validateNote({ title, body });
  const dirty = title !== (note?.title ?? '') || body !== (note?.body ?? '');
  const shownErrors = tried ? errors : {};

  async function save() {
    setTried(true);
    setError(undefined);
    if (!payload) return;
    setBusy(true);
    try {
      if (note) {
        const saved = await updateNote(campaignId, note.id, payload);
        onDone(saved);
        return;
      }
      const saved = await createNote(campaignId, payload.title, payload.text);
      if (show) {
        try {
          await showHandout(campaignId, saved.id);
        } catch (e) {
          setBusy(false);
          // It exists; do not make the DM write it again.
          setError(
            `Saved as a draft, but it could not be shown: ${e instanceof ApiError ? e.message : 'could not reach the server'}. Open it from the list to show it.`,
          );
          return;
        }
      }
      onDone(saved);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Could not reach the server. Nothing was saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={note ? 'Edit note' : 'New note'}
      dirty={dirty}
      onClose={onCancel}
      actions={
        <Button size="2" loading={busy} onClick={() => void save()}>
          {note ? 'Save' : show ? 'Save and show' : 'Save draft'}
        </Button>
      }
    >
      <form
        className="phone-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="phone-field">
          <div className="phone-field-row">
            <label htmlFor={`${id}-title`} className="phone-label">
              Title
            </label>
          </div>
          <TextField.Root
            id={`${id}-title`}
            size="3"
            data-autofocus
            value={title}
            placeholder="The riddle on the door"
            aria-invalid={shownErrors.title ? true : undefined}
            aria-describedby={`${id}-title-help`}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div id={`${id}-title-help`} className="phone-field-foot">
            {shownErrors.title ? (
              <Text size="1" color="red" role="alert">
                {shownErrors.title}
              </Text>
            ) : (
              <span />
            )}
            <Text
              size="1"
              color={title.length > NOTE_LIMITS.title ? 'red' : 'gray'}
              className="phone-count"
            >
              {counter(title.length, NOTE_LIMITS.title)}
            </Text>
          </div>
        </div>
        <MarkdownField
          id={`${id}-body`}
          label="Note"
          value={body}
          onChange={setBody}
          max={NOTE_LIMITS.body}
          rows={12}
          placeholder="Write the note in Markdown…"
          error={shownErrors.body}
        />
        {!note && (
          <Text as="label" size="2" className="phone-switch-row">
            <Flex align="center" gap="3">
              <Switch
                checked={show}
                onCheckedChange={setShow}
                aria-label="Show it to the table now"
              />
              <span>
                <b>Show it to the table now</b>
                <br />
                <Text size="1" color="gray">
                  {show
                    ? 'Every player can read it, and a card appears in the chat.'
                    : 'A draft: only you can see it until you show it.'}
                </Text>
              </span>
            </Flex>
          </Text>
        )}
        {note && (
          <Text size="1" color="gray">
            {note.visibility === 'dm'
              ? 'This note is a draft, so only you see the change.'
              : 'Players who can already read this note see the change as soon as you save.'}
          </Text>
        )}
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
      </form>
    </Sheet>
  );
}
