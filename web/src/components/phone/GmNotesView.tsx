import { Callout, Flex, Text } from '@radix-ui/themes';
import { sizeLabel } from '@vtt-chat-app/shared';
import { useRef } from 'react';

import { useConfirmClick } from '../../hooks/useConfirmClick.js';
import { noteHeadings } from '../../lib/phone/gmNotes.js';
import type { GmNoteFileItem, GmNotesData } from '../../types/phone.js';
import { IconTool } from './IconTool.js';
import { LazyMarkdown } from './LazyMarkdown.js';

function FileRow({
  file,
  busy,
  onOpen,
  onDelete,
}: {
  file: GmNoteFileItem;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const remove = useConfirmClick(onDelete);
  return (
    <li className="phone-note-file">
      <button type="button" className="phone-note-file-open" onClick={onOpen}>
        <Text weight="medium">{file.name}</Text>
        <Text size="1" color="gray">
          {file.kind === 'pdf' ? 'PDF' : 'Picture'} · {sizeLabel(file.bytes)}
        </Text>
      </button>
      <IconTool
        small
        danger
        disabled={busy}
        label={remove.armed ? 'Press again to delete it for good' : 'Delete this attachment'}
        icon="trash"
        pressed={remove.armed}
        onClick={remove.press}
      />
    </li>
  );
}

/**
 * The Game Master's notes page as it is read: the page, a list to jump to its headings, and the attachments below.
 * Presentation only; `GmNotesScreen` loads the page and does the saving, opening and uploading.
 */
export function GmNotesView({
  data,
  busy,
  error,
  onEdit,
  onOpenFile,
  onDeleteFile,
  onAttach,
}: {
  data: GmNotesData;
  busy: boolean;
  error?: string | undefined;
  onEdit: () => void;
  onOpenFile: (file: GmNoteFileItem) => void;
  onDeleteFile: (file: GmNoteFileItem) => void;
  onAttach: (file: File) => void;
}) {
  const page = useRef<HTMLDivElement>(null);
  const headings = noteHeadings(data.body);
  const empty = data.body.trim() === '';
  // The n-th heading in the list is the n-th heading drawn: scroll to it.
  const jump = (index: number) =>
    page.current
      ?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
      [index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <Flex direction="column" gap="4">
      {error && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      <section className="phone-info-card" aria-label="Notes">
        <Flex justify="between" align="start" gap="3">
          <Text size="1" weight="bold" color="gray" className="phone-info-label">
            Only you can read these
          </Text>
          <IconTool small label="Edit the notes" icon="pencil" onClick={onEdit} />
        </Flex>
        {empty ? (
          <Text color="gray" size="2">
            Nothing here yet. Tap the pencil to start: a few headings are ready for you.
          </Text>
        ) : (
          <div ref={page}>
            <LazyMarkdown text={data.body} />
          </div>
        )}
      </section>

      {headings.length >= 2 && (
        <section className="phone-info-card" aria-label="Jump to">
          <Text size="1" weight="bold" color="gray" className="phone-info-label">
            Jump to
          </Text>
          <ul className="phone-note-jump">
            {headings.map((h, i) => (
              <li key={`${i}:${h.text}`} style={{ paddingInlineStart: `${(h.level - 1) * 12}px` }}>
                <button type="button" onClick={() => jump(i)}>
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="phone-info-card" aria-label="Attachments">
        <Text size="1" weight="bold" color="gray" className="phone-info-label">
          Attachments
        </Text>
        {data.files.length === 0 ? (
          <Text color="gray" size="2">
            No attachments yet.
          </Text>
        ) : (
          <ul className="phone-note-files">
            {data.files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                busy={busy}
                onOpen={() => onOpenFile(f)}
                onDelete={() => onDeleteFile(f)}
              />
            ))}
          </ul>
        )}
        <label className="phone-attach">
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onAttach(file);
            }}
          />
          <span>Attach a picture or PDF</span>
        </label>
      </section>
    </Flex>
  );
}
