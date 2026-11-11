import { TextField } from '@radix-ui/themes';
import {
  CHAT_TEXT_MAX,
  looksLikeTypo,
  parseComposerInput,
  suggest,
  type ChatContext,
  type ChatSuggestion,
} from '@vtt-chat-app/shared';
import { useMemo, useState } from 'react';

import { nextUpcoming, planSend } from '../lib/chatSend.js';
import { commandPalette, parseCommand, type Role } from '../lib/commands.js';
import {
  accountErrorMessage,
  campaignApi,
  chatSend,
  panelOpen,
  voiceEffectSet,
} from '../lib/tauriBridge.js';
import { useTableStore } from '../lib/tableStore.js';
import type { RsvpStatus, SessionView } from '../types/index.js';

/** Commands the shared table does not know: they act on this app, not on chat. */
const LOCAL = ['/voice', '/loot', '/take'];
const isLocal = (text: string) => LOCAL.includes(text.trim().split(/\s+/)[0]!.toLowerCase());

/** The message box: `/` autocomplete, kinds (say, do, ooc), whispers and quick messages. Errors show here. */
export function Composer({ selfId, role }: { selfId: string | null; role: Role }) {
  const members = useTableStore((s) => s.members);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [armed, setArmed] = useState<string>();
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState<string>();

  const ctx = useMemo<ChatContext>(
    () => ({
      selfId: selfId ?? '',
      members: members.map((m) => ({
        id: m.userId,
        name: m.displayName,
        characterName: m.character?.name ?? null,
        role: m.role,
      })),
    }),
    [members, selfId],
  );
  const items = useMemo<ChatSuggestion[]>(() => {
    const found = suggest(text, ctx);
    if (found.kind !== 'commands') return found.items;
    const local = commandPalette(text, role)
      .filter((c) => LOCAL.includes(c.name))
      .map((c) => ({ label: c.usage, insert: `${c.name} `, description: c.help }));
    return [...found.items, ...local];
  }, [text, ctx, role]);
  const open = items.length > 0 && dismissed !== text;
  const active = Math.min(pick, Math.max(items.length - 1, 0));
  const self = members.find((m) => m.userId === selfId);
  const selfName = self?.character?.name ?? self?.displayName ?? 'Someone';

  const choose = (item: ChatSuggestion) => {
    setText(item.insert);
    setPick(0);
  };

  async function rsvpNext(status: RsvpStatus) {
    const { sessions } = await campaignApi<{ sessions: SessionView[] }>('GET', 'sessions');
    const next = nextUpcoming(sessions, Date.now());
    if (next) await campaignApi('PUT', `sessions/${next.session.id}/rsvp`, { status });
  }

  async function send() {
    if (text.trim() === '') return;
    setError(undefined);
    setNote(undefined);
    try {
      if (isLocal(text)) {
        const parsed = parseCommand(text, { role, selfId, selfName, members });
        if (parsed.kind === 'error') return setError(parsed.message);
        if (parsed.kind === 'open') await panelOpen(parsed.target);
        else if (parsed.kind === 'voice') await voiceEffectSet(parsed.name);
        setText('');
        return;
      }
      const parsed = parseComposerInput(text, ctx);
      if (parsed.type === 'error') return setError(parsed.message);
      if (parsed.type === 'send' && looksLikeTypo(text) && armed !== text) {
        setArmed(text);
        return setError('No such command — press send again to post it as text');
      }
      const plan = planSend(parsed)!;
      if (plan.whisper) await chatSend(plan.whisper.text, plan.whisper.to);
      if (plan.chat) await chatSend(plan.chat.text, undefined, plan.chat.kind, plan.chat.lang);
      setText('');
      setArmed(undefined);
      if (plan.rsvp) {
        // The line is already posted; a failed RSVP is reported, not retried.
        await rsvpNext(plan.rsvp).catch((e) =>
          setNote(`Posted, but your RSVP was not changed: ${accountErrorMessage(e)}`),
        );
      }
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  return (
    <form
      className="vtt-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {open && (
        <ul className="vtt-palette" role="listbox" id="vtt-composer-list" aria-label="Suggestions">
          {items.map((c, i) => (
            <li
              key={c.insert}
              id={`vtt-composer-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'vtt-palette-on' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
            >
              <b>{c.label}</b> <span>{c.description}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="vtt-composer-error" role="alert">
          {error}
        </div>
      )}
      {note && <div className="vtt-composer-note">{note}</div>}
      <TextField.Root
        size="1"
        aria-label="Message"
        role="combobox"
        aria-expanded={open}
        aria-controls="vtt-composer-list"
        aria-autocomplete="list"
        aria-activedescendant={open ? `vtt-composer-opt-${active}` : undefined}
        placeholder="Message the table…  (type / for commands)"
        value={text}
        maxLength={CHAT_TEXT_MAX}
        onChange={(e) => {
          setText(e.target.value);
          setPick(0);
          setError(undefined);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setPick((active + 1) % items.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setPick((active - 1 + items.length) % items.length);
          } else if (e.key === 'Tab' || (e.key === 'Enter' && items[active]!.insert !== text)) {
            e.preventDefault();
            choose(items[active]!);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDismissed(text);
          }
        }}
      />
    </form>
  );
}
