import { Button, Callout, Select, Text, TextField } from '@radix-ui/themes';
import { useId, useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { defaultStart, toLocalInput, zoneLabel } from '../../lib/phone/datetime.js';
import { createSession, updateSession } from '../../lib/phone/phoneApi.js';
import { counter } from '../../lib/phone/noteForm.js';
import {
  DEFAULT_DURATION,
  SESSION_LIMITS,
  draftFromSession,
  durationChoices,
  durationLabel,
  nextSessionTitle,
  sameDraft,
  sessionPatch,
  validateSession,
  type SessionDraft,
} from '../../lib/phone/sessionForm.js';
import type { SessionItem } from '../../types/phone.js';
import { MarkdownField } from './MarkdownField.js';
import { Sheet } from './Sheet.js';

/** Schedule a session, or change one. Times are read and shown in this device's own zone; the server stores the instant. */
export function SessionEditor({
  campaignId,
  session,
  titles,
  onDone,
  onCancel,
}: {
  campaignId: string;
  /** The session being changed; none when scheduling a new one. */
  session?: SessionItem['session'];
  /** The titles already scheduled, to suggest the next "Session N". */
  titles: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  // The form starts from what it was opened with; later list refreshes must not overwrite what is being typed.
  const [initial] = useState<SessionDraft>(() =>
    session
      ? draftFromSession(session)
      : {
          title: nextSessionTitle(titles),
          start: toLocalInput(defaultStart(Date.now())),
          duration: DEFAULT_DURATION,
          notes: '',
        },
  );
  const [draft, setDraft] = useState<SessionDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [tried, setTried] = useState(false);
  const set = <K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const moved = !session || draft.start !== initial.start;
  const { errors, payload } = validateSession(draft, Date.now(), moved);
  const shown = tried ? errors : {};
  const dirty = !sameDraft(draft, initial);
  const startMs = payload?.startsAt ?? Date.now();

  async function save() {
    setTried(true);
    setError(undefined);
    if (!payload) return;
    setBusy(true);
    try {
      if (session) {
        const patch = sessionPatch(session, payload);
        if (Object.keys(patch).length > 0) await updateSession(campaignId, session.id, patch);
      } else {
        await createSession(campaignId, payload);
      }
      onDone();
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
      title={session ? 'Edit session' : 'Schedule a session'}
      dirty={dirty}
      onClose={onCancel}
      actions={
        <Button size="2" loading={busy} onClick={() => void save()}>
          {session ? 'Save' : 'Schedule'}
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
          <label htmlFor={`${id}-title`} className="phone-label">
            Title
          </label>
          <TextField.Root
            id={`${id}-title`}
            size="3"
            data-autofocus
            value={draft.title}
            aria-invalid={shown.title ? true : undefined}
            aria-describedby={`${id}-title-help`}
            onChange={(e) => set('title', e.target.value)}
          />
          <div id={`${id}-title-help`} className="phone-field-foot">
            {shown.title ? (
              <Text size="1" color="red" role="alert">
                {shown.title}
              </Text>
            ) : (
              <span />
            )}
            <Text size="1" color={draft.title.length > SESSION_LIMITS.title ? 'red' : 'gray'}>
              {counter(draft.title.length, SESSION_LIMITS.title)}
            </Text>
          </div>
        </div>
        <div className="phone-field">
          <label htmlFor={`${id}-start`} className="phone-label">
            Date and time
          </label>
          <input
            id={`${id}-start`}
            type="datetime-local"
            className="phone-input"
            value={draft.start}
            step={300}
            required
            aria-invalid={shown.start ? true : undefined}
            aria-describedby={`${id}-start-help`}
            onChange={(e) => set('start', e.target.value)}
          />
          <div id={`${id}-start-help`} className="phone-field-foot">
            {shown.start ? (
              <Text size="1" color="red" role="alert">
                {shown.start}
              </Text>
            ) : (
              <Text size="1" color="gray">
                Your time: {zoneLabel(startMs)}. Players see it in theirs.
              </Text>
            )}
          </div>
        </div>
        <div className="phone-field">
          <label htmlFor={`${id}-duration`} className="phone-label">
            Duration
          </label>
          <Select.Root
            size="3"
            value={String(draft.duration)}
            onValueChange={(v) => set('duration', Number(v))}
          >
            <Select.Trigger id={`${id}-duration`} />
            <Select.Content>
              {durationChoices(initial.duration).map((m) => (
                <Select.Item key={m} value={String(m)}>
                  {durationLabel(m)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
        <MarkdownField
          id={`${id}-notes`}
          label="Notes (optional)"
          value={draft.notes}
          onChange={(v) => set('notes', v)}
          max={SESSION_LIMITS.notes}
          rows={5}
          placeholder="Where, what to bring, anything players should know…"
          error={shown.notes}
        />
        {!session && (
          <Text size="1" color="gray">
            Players are notified when you schedule it.
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
