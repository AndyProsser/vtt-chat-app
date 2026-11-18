import { looksLikeSheetLink } from '@vtt-chat-app/shared';
import { Flex, Text, TextField } from '@radix-ui/themes';
import { useState } from 'react';

import { IconTool } from './IconTool.js';

/** The box for pasting a public D&D Beyond sheet link, with the button that reads it. */
export function DdbLinkField({
  busy,
  action = 'Link',
  onLink,
}: {
  busy: boolean;
  /** The button's words: "Link" for an existing character, "Import" when creating one from the sheet. */
  action?: string;
  onLink: (url: string) => void | Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const ok = looksLikeSheetLink(text);
  return (
    <Flex direction="column" gap="2">
      <Text size="2" color="gray">
        Paste the link to your character&apos;s sheet (it must be shared publicly on D&amp;D
        Beyond).
      </Text>
      <Flex gap="2" wrap="wrap">
        <TextField.Root
          style={{ flex: 1, minWidth: 180 }}
          aria-label="D&D Beyond character link"
          placeholder="https://www.dndbeyond.com/characters/…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok && !busy) void onLink(text.trim());
          }}
        />
        <IconTool
          label={`${action} this D&D Beyond sheet`}
          text={action}
          icon="link"
          disabled={busy || !ok}
          onClick={() => void onLink(text.trim())}
        />
      </Flex>
    </Flex>
  );
}
