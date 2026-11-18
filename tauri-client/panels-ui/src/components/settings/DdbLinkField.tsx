import { looksLikeSheetLink } from '@vtt-chat-app/shared';
import { TextField } from '@radix-ui/themes';
import { Link2 } from 'lucide-react';
import { useState } from 'react';

import { ToolButton } from '../ToolButton.js';

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
    <>
      <span className="vtt-muted">
        Paste the link to your character&apos;s sheet (it must be shared publicly on D&amp;D
        Beyond).
      </span>
      <div className="vtt-form-row">
        <TextField.Root
          size="1"
          style={{ flex: 1, minWidth: 140 }}
          aria-label="D&D Beyond character link"
          placeholder="https://www.dndbeyond.com/characters/…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok && !busy) void onLink(text.trim());
          }}
        />
        <ToolButton
          label={`${action} this D&D Beyond sheet`}
          text={action}
          disabled={busy || !ok}
          onClick={() => void onLink(text.trim())}
        >
          <Link2 size={14} />
        </ToolButton>
      </div>
    </>
  );
}
