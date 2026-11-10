import { Button, Flex, Select, Text, TextArea } from '@radix-ui/themes';
import { useState } from 'react';

import type { Member } from '../../types/phone.js';

const EVERYONE = '*';

/** The box under the chat. Whisper by choosing a person; the text is kept if the line did not go out. */
export function Composer({
  members,
  say,
}: {
  members: Member[];
  say: (text: string, to?: string) => boolean;
}) {
  const [text, setText] = useState('');
  const [to, setTo] = useState(EVERYONE);
  const [failed, setFailed] = useState(false);

  function send() {
    const body = text.trim();
    if (body === '') return;
    const sent = say(body, to === EVERYONE ? undefined : to);
    setFailed(!sent);
    if (sent) setText('');
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
            {members.map((m) => (
              <Select.Item key={m.userId} value={m.userId}>
                Whisper to {m.displayName}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <Flex gap="2" align="end">
        <TextArea
          id="phone-compose"
          aria-label="Message"
          placeholder={to === EVERYONE ? 'Message the table' : 'Whisper'}
          size="3"
          rows={1}
          maxLength={4000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFailed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          style={{ flex: 1 }}
        />
        <Button size="3" disabled={text.trim() === ''} onClick={send}>
          Send
        </Button>
      </Flex>
      {failed && (
        <Text size="1" color="red" role="alert">
          Not connected, so that did not send. Your text is still here.
        </Text>
      )}
    </Flex>
  );
}
