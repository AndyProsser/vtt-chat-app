import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { handoutPicture } from '../lib/handoutPicture.js';
import { handoutIdFromHash } from '../lib/panelName.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import {
  accountErrorMessage,
  campaignApi,
  campaignFile,
  onHandoutView,
} from '../lib/tauriBridge.js';
import type { Handout } from '../types/index.js';
import { FlipPanel } from './FlipPanel.js';
import { ImageZoom } from './ImageZoom.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { MarkdownView } from './MarkdownView.js';
import { PdfView } from './PdfView.js';
import { ToolButton } from './ToolButton.js';

/** One picture of a set, with zoom; the zoom starts again for each picture. */
function SetPicture({ id, title, index }: { id: string; title: string; index: number }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSrc(undefined);
    setFailed(false);
    handoutPicture(id, index).then(
      (s) => !cancelled && setSrc(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [id, index]);
  if (failed) return <span className="vtt-muted">Could not load the picture.</span>;
  if (!src) return <span className="vtt-muted">Loading…</span>;
  return <ImageZoom key={`${id}:${index}`} src={src} alt={`${title}, picture ${index + 1}`} />;
}

/**
 * One handout, large, in a window of its own (opened from its card in chat). Players read it; the DM can
 * also edit its title and text. A set of pictures flips and zooms (maps can be huge), and a PDF is read
 * here page by page.
 */
export function HandoutViewer() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const [id, setId] = useState(() => handoutIdFromHash(window.location.hash));
  const [handout, setHandout] = useState<Handout>();
  const [pdf, setPdf] = useState<string>();
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  // Another card was clicked while this window is open.
  useEffect(() => {
    const unlisten = onHandoutView((next) => {
      setId(next);
      setEditing(false);
    });
    return () => void unlisten.then((fn) => fn());
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setHandout(undefined);
    setPdf(undefined);
    setIndex(0);
    setError(undefined);
    campaignApi<{ handout: Handout }>('GET', `handouts/${id}`)
      .then(async ({ handout: h }) => {
        if (cancelled) return;
        setHandout(h);
        if (h.kind === 'pdf' && h.hasFile) {
          const data = await campaignFile(`handouts/${id}/file`);
          if (!cancelled) setPdf(data);
        }
      })
      .catch((e: unknown) => !cancelled && setError(accountErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  function startEditing() {
    if (!handout) return;
    setTitle(handout.title);
    setText(handout.body ?? '');
    setEditing(true);
  }

  async function save() {
    if (!handout) return;
    setSaving(true);
    try {
      const { handout: next } = await campaignApi<{ handout: Handout }>(
        'PATCH',
        `handouts/${handout.id}`,
        { title, text },
      );
      setHandout(next);
      setEditing(false);
      setError(undefined);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!id) return <div className="vtt-viewer vtt-muted">No handout selected.</div>;
  const note = handout?.kind === 'text';
  const pictures = handout && (handout.kind === 'image' || handout.kind === 'map');
  return (
    <div className="vtt-viewer">
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {!handout && !error && <span className="vtt-muted">Loading…</span>}
      {handout && (
        <>
          <header className="vtt-viewer-head">
            {editing ? (
              <input
                className="vtt-input"
                style={{ flex: 1 }}
                aria-label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            ) : (
              <h2 className="vtt-head">{handout.title}</h2>
            )}
            {dm && !editing && (
              <ToolButton label="Edit this handout" onClick={startEditing}>
                <Pencil size={14} />
              </ToolButton>
            )}
            {editing && (
              <span className="vtt-form-row">
                <ToolButton
                  label="Save the changes"
                  text="Save"
                  disabled={saving || title.trim() === ''}
                  onClick={() => void save()}
                >
                  <Check size={14} />
                </ToolButton>
                <ToolButton label="Discard the changes" onClick={() => setEditing(false)}>
                  <X size={14} />
                </ToolButton>
              </span>
            )}
          </header>
          {note &&
            (editing ? (
              <MarkdownEditor value={text} onChange={setText} />
            ) : (
              <MarkdownView text={handout.body ?? ''} />
            ))}
          {!note &&
            (editing ? (
              <textarea
                className="vtt-input"
                aria-label="Caption"
                placeholder="A line or two to go with it (optional)"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            ) : (
              handout.body && <p className="vtt-viewer-caption">{handout.body}</p>
            ))}
          {pictures && (
            <FlipPanel count={handout.fileCount} index={index} onIndex={setIndex}>
              <SetPicture id={handout.id} title={handout.title} index={index} />
            </FlipPanel>
          )}
          {handout.kind === 'pdf' &&
            (pdf ? <PdfView dataUrl={pdf} /> : <span className="vtt-muted">Loading the PDF…</span>)}
        </>
      )}
    </div>
  );
}
