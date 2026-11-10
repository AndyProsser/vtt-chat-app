import { TextArea } from '@radix-ui/themes';
import { Bold, Eye, Heading2, Italic, List, Minus, Pencil, Quote } from 'lucide-react';
import { useRef, useState } from 'react';

import { applyFormat, type FormatKind } from '../lib/markdownFormat.js';
import { MarkdownView } from './MarkdownView.js';
import { ToolButton } from './ToolButton.js';

const TOOLS: { kind: FormatKind; label: string; icon: typeof Bold }[] = [
  { kind: 'bold', label: 'Bold', icon: Bold },
  { kind: 'italic', label: 'Italic', icon: Italic },
  { kind: 'heading', label: 'Heading', icon: Heading2 },
  { kind: 'list', label: 'Bulleted list', icon: List },
  { kind: 'quote', label: 'Quote (read-aloud text)', icon: Quote },
  { kind: 'rule', label: 'Divider', icon: Minus },
];

/** A small Markdown editor: a toolbar over a textarea, and a preview of what the players will read. */
export function MarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function format(kind: FormatKind) {
    const el = area.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const edit = applyFormat(value, start, end, kind);
    onChange(edit.text);
    // Restore the selection once React has put the new text in.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(edit.start, edit.end);
    });
  }

  return (
    <div className="vtt-editor">
      <div className="vtt-form-row">
        {TOOLS.map(({ kind, label, icon: Icon }) => (
          <ToolButton key={kind} label={label} disabled={preview} onClick={() => format(kind)}>
            <Icon size={14} />
          </ToolButton>
        ))}
        <span className="vtt-spacer" />
        <ToolButton
          label={preview ? 'Back to editing' : 'Preview what players will read'}
          pressed={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? <Pencil size={14} /> : <Eye size={14} />}
        </ToolButton>
      </div>
      {preview ? (
        <div className="vtt-editor-preview">
          {value.trim() ? (
            <MarkdownView text={value} />
          ) : (
            <span className="vtt-muted">Nothing to preview yet.</span>
          )}
        </div>
      ) : (
        <TextArea
          size="1"
          ref={area}
          className="vtt-editor-area"
          aria-label="Handout text"
          placeholder="Write the handout in Markdown…"
          value={value}
          maxLength={20000}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
