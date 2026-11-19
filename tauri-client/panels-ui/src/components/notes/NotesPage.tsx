import { Button } from '@radix-ui/themes';
import { GM_NOTES_BODY_MAX } from '@vtt-chat-app/shared';
import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { editorStart } from '../../lib/gmNotes.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { GmNoteFile, GmNotesData } from '../../types/index.js';
import { MarkdownEditor } from '../MarkdownEditor.js';
import { ToolButton } from '../ToolButton.js';
import { FilePreview } from './FilePreview.js';
import { NoteFiles } from './NoteFiles.js';
import { NotesMarkdown } from './NotesMarkdown.js';

interface Heading {
  level: number;
  text: string;
  el: HTMLElement;
}

/**
 * The Game Master's one page of notes. **View** mode reads it, with a sidebar on the right listing every heading
 * (click to jump) and the attachments below it; **edit** mode is the Markdown editor, with the starter headings on a
 * page that has never had text. Only the Game Master ever sees this.
 */
export function NotesPage({ data, reload }: { data: GmNotesData; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [discarding, setDiscarding] = useState(false);
  const [preview, setPreview] = useState<GmNoteFile | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const content = useRef<HTMLDivElement>(null);
  const dirty = editing && draft !== data.body && draft !== editorStart(data.body);

  // The headings are read from what was drawn, so the sidebar always matches the page, whatever the Markdown.
  useEffect(() => {
    if (editing || !content.current) return setHeadings([]);
    const found = [...content.current.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')];
    setHeadings(
      found.map((el) => ({
        level: Number(el.tagName.slice(1)),
        text: el.textContent ?? '',
        el,
      })),
    );
  }, [editing, data.body]);

  function startEditing() {
    setDraft(editorStart(data.body));
    setError(undefined);
    setDiscarding(false);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await campaignApi('PUT', 'gm/notes', { body: draft });
      reload();
      setEditing(false);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty && !discarding) return setDiscarding(true);
    setEditing(false);
    setDiscarding(false);
  }

  const shown = data.body.trim() === '';
  return (
    <div className="vtt-notes">
      <div className="vtt-notes-main">
        <div className="vtt-form-row">
          <b className="vtt-head">{editing ? 'Editing your notes' : 'Your notes'}</b>
          <span className="vtt-spacer" />
          {!editing && (
            <ToolButton label="Edit the notes" onClick={startEditing}>
              <Pencil size={14} />
            </ToolButton>
          )}
        </div>
        <span className="vtt-muted">Only you can see these notes.</span>
        {editing ? (
          <form
            className="vtt-session"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              maxLength={GM_NOTES_BODY_MAX}
              label="Game Master notes"
              placeholder="Anything you want to remember, in Markdown…"
              previewLabel="Preview the notes"
              renderPreview={(text) => <NotesMarkdown text={text} />}
            />
            {error && (
              <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
                {error}
              </div>
            )}
            <div className="vtt-form-row">
              <Button size="1" type="submit" loading={saving}>
                Save
              </Button>
              <Button size="1" type="button" variant="soft" color="gray" onClick={cancel}>
                {discarding ? 'Discard changes?' : 'Cancel'}
              </Button>
            </div>
          </form>
        ) : shown ? (
          <span className="vtt-muted">
            Nothing here yet. Press the pencil to start; the page begins with a few headings to
            prompt you, and you can delete any of them.
          </span>
        ) : (
          <NotesMarkdown ref={content} text={data.body} />
        )}
      </div>
      <aside className="vtt-notes-side">
        {!editing && headings.length > 0 && (
          <nav aria-label="Headings">
            <div className="vtt-notes-side-head">
              <b>On this page</b>
            </div>
            {headings.map((h, i) => (
              <button
                key={i}
                type="button"
                className="vtt-notes-heading"
                style={{ paddingLeft: 4 + (h.level - 1) * 10 }}
                onClick={() => h.el.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {h.text}
              </button>
            ))}
          </nav>
        )}
        <NoteFiles
          files={data.files}
          maxFileBytes={data.maxFileBytes}
          editing={editing}
          onOpen={setPreview}
          onChanged={reload}
        />
      </aside>
      <FilePreview file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
