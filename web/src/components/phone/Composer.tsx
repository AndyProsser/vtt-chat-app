import { Button, Flex, Select, Text, TextArea } from '@radix-ui/themes';
import { CHAT_TEXT_MAX, looksLikeTypo, parseComposerInput, suggest } from '@vtt-chat-app/shared';
import { useId, useMemo, useRef, useState } from 'react';

import {
  chatContext,
  nextUpcomingSession,
  planSend,
  TYPO_WARNING,
  visibleSuggestions,
} from '../../lib/phone/compose.js';
import { answerRsvp, sessions } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import type { SayOptions } from '../../lib/phone/socket.js';
import type { Member } from '../../types/phone.js';

const EVERYONE = '*';

/**
 * The box under the chat. A leading "/" opens a list of commands (see CHAT-COMMANDS.md); the picker above
 * still whispers to one person. The text is kept if the line did not go out.
 */
export function Composer({
  campaignId,
  selfId,
  members,
  say,
}: {
  campaignId: string;
  selfId: string;
  /** Everyone at the table, you included. */
  members: Member[];
  say: (text: string, o?: SayOptions) => boolean;
}) {
  const [text, setText] = useState('');
  const [to, setTo] = useState(EVERYONE);
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [note, setNote] = useState<string>();
  const [armed, setArmed] = useState<string>();
  const [active, setActive] = useState(0);
  const [closedFor, setClosedFor] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const serverError = usePhoneStore((s) => s.chatError);

  const ctx = useMemo(() => chatContext(selfId, members), [selfId, members]);
  const whispering = to !== EVERYONE;
  const items = useMemo(
    () => (whispering ? [] : visibleSuggestions(suggest(text, ctx), text)),
    [text, ctx, whispering],
  );
  const open = items.length > 0 && closedFor !== text;
  const optionId = (i: number) => `${listId}-${i}`;
  const shown = problem ?? (armed === text ? TYPO_WARNING : undefined) ?? serverError;

  function edit(next: string) {
    setText(next);
    setActive(0);
    setClosedFor(undefined);
    setFailed(false);
    setProblem(undefined);
    setNote(undefined);
    setArmed(undefined);
    usePhoneStore.getState().clearChatError();
  }

  function pick(i: number) {
    const item = items[i];
    if (!item) return;
    edit(item.insert);
    input.current?.focus();
  }

  async function setRsvp(status: 'late' | 'no') {
    try {
      const next = nextUpcomingSession(await sessions(campaignId), Date.now());
      if (next) await answerRsvp(campaignId, next.session.id, status);
    } catch {
      setNote('Posted, but your RSVP for the next session could not be saved.');
    }
  }

  function send() {
    const body = text.trim();
    if (body === '') return;
    if (whispering) {
      const sent = say(body, { to });
      setFailed(!sent);
      if (sent) edit('');
      return;
    }
    const parsed = parseComposerInput(body, ctx);
    if (parsed.type === 'error') {
      setProblem(parsed.message);
      return;
    }
    // A slash that is probably a slip: warn once, and post it as text on the second send.
    if (parsed.type === 'send' && parsed.kind === 'chat' && armed !== text && looksLikeTypo(body)) {
      setArmed(text);
      return;
    }
    const plan = planSend(parsed);
    if (!plan) return;
    const sent = say(plan.text, plan.say);
    setFailed(!sent);
    if (!sent) return;
    edit('');
    if (plan.rsvp) void setRsvp(plan.rsvp);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : items.length - 1;
        setActive((active + step) % items.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey)) {
        e.preventDefault();
        pick(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setClosedFor(text);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  return (
    <Flex direction="column" gap="2" className="phone-composer">
      <Flex gap="2" align="center">
        <Text size="1" color="gray">
          To
        </Text>
        <Select.Root value={to} onValueChange={setTo}>
          <Select.Trigger aria-label="Who to send to" variant="soft" />
          <Select.Content>
            <Select.Item value={EVERYONE}>Everyone</Select.Item>
            {members
              .filter((m) => m.userId !== selfId)
              .map((m) => (
                <Select.Item key={m.userId} value={m.userId}>
                  Whisper to {m.displayName}
                </Select.Item>
              ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <div className="phone-compose-wrap">
        {open && (
          <ul id={listId} role="listbox" aria-label="Suggestions" className="phone-suggest">
            {items.map((item, i) => (
              <li
                key={item.insert}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={`phone-suggest-item ${i === active ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
              >
                <span className="phone-suggest-label">{item.label}</span>
                <span className="phone-suggest-desc">{item.description}</span>
              </li>
            ))}
          </ul>
        )}
        <Flex gap="2" align="end">
          <TextArea
            ref={input}
            id="phone-compose"
            aria-label="Message"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open ? optionId(active) : undefined}
            placeholder={whispering ? 'Whisper' : 'Message the table, or type / for commands'}
            size="3"
            rows={1}
            maxLength={CHAT_TEXT_MAX}
            value={text}
            onChange={(e) => edit(e.target.value)}
            onKeyDown={onKeyDown}
            style={{ flex: 1 }}
          />
          <Button size="3" disabled={text.trim() === ''} onClick={send}>
            Send
          </Button>
        </Flex>
      </div>
      {shown && (
        <Text size="1" color={armed === text && !problem ? 'amber' : 'red'} role="alert">
          {shown}
        </Text>
      )}
      {note && (
        <Text size="1" color="amber" role="status">
          {note}
        </Text>
      )}
      {failed && (
        <Text size="1" color="red" role="alert">
          Not connected, so that did not send. Your text is still here.
        </Text>
      )}
    </Flex>
  );
}
