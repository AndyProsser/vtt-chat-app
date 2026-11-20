import { FileText, Image, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { attachmentProblem, sizeLabel } from '../../lib/gmNotes.js';
import { fileToBase64 } from '../../lib/handoutTools.js';
import { accountErrorMessage, campaignApi, gmNoteUpload } from '../../lib/tauriBridge.js';
import type { GmNoteFile } from '../../types/index.js';
import { ToolButton } from '../ToolButton.js';

/**
 * The notes' attachments. Anyone reading can open one in the preview; adding and removing is in edit mode
 * (`editing`). The ceiling comes from the server, so the app can say so before sending a large file.
 */
export function NoteFiles({
  files,
  maxFileBytes,
  editing,
  onOpen,
  onChanged,
}: {
  files: GmNoteFile[];
  maxFileBytes: number;
  editing: boolean;
  onOpen: (file: GmNoteFile) => void;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState<string>();

  async function add(list: FileList | null) {
    const picked = [...(list ?? [])];
    if (input.current) input.current.value = '';
    setError(undefined);
    setBusy(true);
    try {
      for (const file of picked) {
        const problem = attachmentProblem(file, maxFileBytes);
        if (problem) {
          setError(`${file.name}: ${problem}`);
          continue;
        }
        await gmNoteUpload(file.name, await fileToBase64(file));
      }
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  async function remove(id: string) {
    setError(undefined);
    try {
      await campaignApi('DELETE', `gm/notes/files/${id}`);
    } catch (e) {
      setError(accountErrorMessage(e));
    }
    setAsking(undefined);
    onChanged();
  }

  return (
    <section className="vtt-notes-files" aria-label="Attachments">
      <div className="vtt-notes-side-head">
        <b>Attachments</b>
        {editing && (
          <>
            <ToolButton
              label="Attach a picture or PDF"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Paperclip size={14} />
            </ToolButton>
            <input
              ref={input}
              type="file"
              hidden
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf"
              onChange={(e) => void add(e.target.files)}
            />
          </>
        )}
      </div>
      {files.length === 0 && (
        <span className="vtt-muted">
          {editing ? 'Nothing attached yet.' : 'No attachments. Add some in edit mode.'}
        </span>
      )}
      {files.map((f) => (
        <div key={f.id} className="vtt-notes-file">
          <button type="button" className="vtt-notes-file-open" onClick={() => onOpen(f)}>
            {f.kind === 'pdf' ? <FileText size={14} /> : <Image size={14} />}
            <span className="vtt-notes-file-name">{f.name}</span>
            <small className="vtt-muted">{sizeLabel(f.bytes)}</small>
          </button>
          {editing &&
            (asking === f.id ? (
              <button type="button" className="vtt-notes-sure" onClick={() => void remove(f.id)}>
                Remove?
              </button>
            ) : (
              <ToolButton label={`Remove ${f.name}`} danger onClick={() => setAsking(f.id)}>
                <Trash2 size={13} />
              </ToolButton>
            ))}
        </div>
      ))}
      {busy && <span className="vtt-muted">Attaching…</span>}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </section>
  );
}
