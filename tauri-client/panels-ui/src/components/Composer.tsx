import { TextField } from '@radix-ui/themes';
import { useMemo, useState } from 'react';

import { commandPalette, parseCommand, type Role } from '../lib/commands.js';
import { accountErrorMessage, chatSend, panelOpen, voiceEffectSet } from '../lib/tauriBridge.js';
import { useTableStore } from '../lib/tableStore.js';

/** The message box, with a `/` command palette. Parse errors show here and send nothing. */
export function Composer({ selfId, role }: { selfId: string | null; role: Role }) {
  const members = useTableStore((s) => s.members);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [pick, setPick] = useState(0);
  const palette = useMemo(() => commandPalette(text, role), [text, role]);
  const showPalette = palette.length > 0 && !text.includes(' ');
  const self = members.find((m) => m.userId === selfId);
  const selfName = self?.character?.name ?? self?.displayName ?? 'Someone';

  async function send() {
    if (text.trim() === '') return;
    const parsed = parseCommand(text, { role, selfId, selfName, members });
    setError(undefined);
    try {
      if (parsed.kind === 'error') return setError(parsed.message);
      if (parsed.kind === 'open') await panelOpen(parsed.target);
      else if (parsed.kind === 'voice') await voiceEffectSet(parsed.name);
      else if (parsed.kind === 'whisper') await chatSend(parsed.text, parsed.toUserId);
      else await chatSend(parsed.text);
      setText('');
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
      {showPalette && (
        <ul className="vtt-palette" role="listbox">
          {palette.map((c, i) => (
            <li
              key={c.name}
              role="option"
              aria-selected={i === pick}
              className={i === pick ? 'vtt-palette-on' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                setText(`${c.name} `);
              }}
            >
              <b>{c.usage}</b> <span>{c.help}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="vtt-composer-error" role="alert">
          {error}
        </div>
      )}
      <TextField.Root
        size="1"
        aria-label="Message"
        placeholder="Message the table…  (/w name to whisper)"
        value={text}
        maxLength={2000}
        onChange={(e) => {
          setText(e.target.value);
          setPick(0);
        }}
        onKeyDown={(e) => {
          if (!showPalette) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setPick((p) => (p + 1) % palette.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setPick((p) => (p - 1 + palette.length) % palette.length);
          } else if (e.key === 'Tab') {
            e.preventDefault();
            setText(`${palette[pick]!.name} `);
          }
        }}
      />
    </form>
  );
}
