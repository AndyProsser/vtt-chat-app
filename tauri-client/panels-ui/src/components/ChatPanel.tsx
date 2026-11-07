import { Button, Flex, Select, Text, TextField } from '@radix-ui/themes';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { whisperTargets } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, chatSend } from '../lib/tauriBridge.js';

const EVERYONE = '__everyone__';

export function ChatPanel() {
  useTableFeed();
  const { status } = useAccount();
  const chat = useTableStore((s) => s.chat);
  const members = useTableStore((s) => s.members);
  const selfId = status?.userId ?? null;
  const targets = useMemo(() => whisperTargets(members, selfId), [members, selfId]);
  const [to, setTo] = useState(EVERYONE);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setError(undefined);
    try {
      await chatSend(body, to === EVERYONE ? undefined : to);
      setText('');
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  return (
    <Flex direction="column" gap="2" p="3" style={{ height: '100vh', boxSizing: 'border-box' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {chat.map((line) => {
          const mine = line.from.userId === selfId;
          const whisper = line.to !== undefined;
          return (
            <Text as="p" size="2" key={line.id} style={{ margin: '0 0 6px' }}>
              <Text weight="bold" color={whisper ? 'violet' : undefined}>
                {mine ? 'You' : line.from.name}
                {whisper && ` → ${line.to?.userId === selfId ? 'you' : line.to?.name} (whisper)`}
              </Text>
              {': '}
              {line.text}
            </Text>
          );
        })}
        <div ref={end} />
      </div>
      {error && (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      )}
      <Flex gap="2">
        <Select.Root value={to} onValueChange={setTo}>
          <Select.Trigger aria-label="Send to" />
          <Select.Content>
            <Select.Item value={EVERYONE}>Everyone</Select.Item>
            {targets.map((m) => (
              <Select.Item key={m.userId} value={m.userId}>
                Whisper: {m.character?.name ?? m.displayName}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <form
          style={{ flex: 1, display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <TextField.Root
            style={{ flex: 1 }}
            aria-label="Message"
            placeholder="Message"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" disabled={text.trim() === ''}>
            Send
          </Button>
        </form>
      </Flex>
    </Flex>
  );
}
