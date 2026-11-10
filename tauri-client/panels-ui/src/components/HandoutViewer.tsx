import { TextArea, TextField } from '@radix-ui/themes';
import { ArrowLeft, ArrowRight, Check, ImagePlus, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { forgetHandoutPictures, handoutPicture } from '../lib/handoutPicture.js';
import { moveOrder } from '../lib/pictureOrder.js';
import { handoutIdFromHash } from '../lib/panelName.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import {
  accountErrorMessage,
  campaignApi,
  campaignFile,
  handoutAddImage,
  onHandoutView,
} from '../lib/tauriBridge.js';
import type { Handout } from '../types/index.js';
import { FlipPanel } from './FlipPanel.js';
import { ImageZoom } from './ImageZoom.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { MarkdownView } from './MarkdownView.js';
import { PdfView } from './PdfView.js';
import { fileToBase64, MAX_PICTURES } from '../lib/handoutTools.js';
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

/** A small picture for the editing strip. */
function Thumb({ id, index, version }: { id: string; index: number; version: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    setSrc(undefined);
    handoutPicture(id, index).then(
      (s) => !cancelled && setSrc(s),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [id, index, version]);
  return src ? <img src={src} alt={`Picture ${index + 1}`} /> : <span aria-hidden />;
}

/**
 * The DM's strip for a set of pictures: move one earlier or later, take one out (never the last), or add
 * another. Each change is saved at once; the server keeps the order.
 */
function PictureEditor({
  handout,
  onChanged,
  onError,
}: {
  handout: Handout;
  onChanged: (next: Handout) => void;
  onError: (message: string) => void;
}) {
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);

  async function run(call: () => Promise<{ handout: Handout }>) {
    setBusy(true);
    try {
      const { handout: next } = await call();
      forgetHandoutPictures(handout.id);
      setVersion((v) => v + 1);
      onChanged(next);
    } catch (e) {
      onError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vtt-pic-editor">
      <div className="vtt-thumbs">
        {Array.from({ length: handout.fileCount }, (_, i) => (
          <span key={i} className="vtt-thumb vtt-thumb-edit">
            <Thumb id={handout.id} index={i} version={version} />
            <span className="vtt-thumb-tools">
              <button
                type="button"
                aria-label={`Move picture ${i + 1} earlier`}
                disabled={busy || i === 0}
                onClick={() =>
                  void run(() =>
                    campaignApi('PUT', `handouts/${handout.id}/files`, {
                      order: moveOrder(handout.fileCount, i, -1),
                    }),
                  )
                }
              >
                <ArrowLeft size={11} />
              </button>
              <button
                type="button"
                aria-label={`Remove picture ${i + 1}`}
                disabled={busy || handout.fileCount <= 1}
                onClick={() =>
                  void run(() => campaignApi('DELETE', `handouts/${handout.id}/files/${i}`))
                }
              >
                <Trash2 size={11} />
              </button>
              <button
                type="button"
                aria-label={`Move picture ${i + 1} later`}
                disabled={busy || i === handout.fileCount - 1}
                onClick={() =>
                  void run(() =>
                    campaignApi('PUT', `handouts/${handout.id}/files`, {
                      order: moveOrder(handout.fileCount, i, 1),
                    }),
                  )
                }
              >
                <ArrowRight size={11} />
              </button>
            </span>
          </span>
        ))}
      </div>
      <input
        ref={chooser}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            void run(async () => {
              await handoutAddImage(handout.id, file.name || 'upload', await fileToBase64(file));
              return campaignApi<{ handout: Handout }>('GET', `handouts/${handout.id}`);
            });
        }}
      />
      <ToolButton
        label="Add another picture"
        text="Add"
        disabled={busy || handout.fileCount >= MAX_PICTURES}
        onClick={() => chooser.current?.click()}
      >
        <ImagePlus size={14} />
      </ToolButton>
    </div>
  );
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
              <TextField.Root
                size="1"
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
              <TextArea
                size="1"
                aria-label="Caption"
                placeholder="A line or two to go with it (optional)"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            ) : (
              handout.body && <p className="vtt-viewer-caption">{handout.body}</p>
            ))}
          {pictures && editing && (
            <PictureEditor
              handout={handout}
              onChanged={(next) => {
                setHandout(next);
                setIndex(0);
              }}
              onError={setError}
            />
          )}
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
