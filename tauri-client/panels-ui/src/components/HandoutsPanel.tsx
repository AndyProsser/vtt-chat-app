import {
  ClipboardPaste,
  Eye,
  EyeOff,
  FileText,
  ImagePlus,
  Maximize2,
  Paperclip,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { handoutPicture } from '../lib/handoutPicture.js';
import {
  canCreateHandout,
  fileFromBase64,
  fileToBase64,
  imageFromClipboard,
  isShared,
  MAX_PICTURES,
  pastedTitle,
  type NewHandoutMode,
  removalWarning,
  searchHandouts,
} from '../lib/handoutTools.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import {
  accountErrorMessage,
  campaignApi,
  clipboardPicture,
  handoutAddImage,
  handoutUpload,
  handoutViewOpen,
} from '../lib/tauriBridge.js';
import type { Handout } from '../types/index.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { MarkdownView } from './MarkdownView.js';
import { ToolButton } from './ToolButton.js';

/** The first picture of a handout, small, in the handouts list (the viewer window flips and zooms). */
function Picture({ id, title, count }: { id: string; title: string; count: number }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    handoutPicture(id, 0).then(
      (s) => !cancelled && setSrc(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (failed) return <span className="vtt-muted">Could not load the picture.</span>;
  return src ? (
    <img
      src={src}
      alt={count > 1 ? `${title}, first of ${count} pictures` : title}
      className="vtt-handout-img"
    />
  ) : null;
}

function Item({
  h,
  dm,
  act,
  remove,
}: {
  h: Handout;
  dm: boolean;
  act: (path: string) => void;
  remove: (h: Handout) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const warning = removalWarning(h);
  return (
    <article className="vtt-session">
      <div className="vtt-session-head">
        <b>
          {h.kind === 'text' ? <FileText size={14} style={{ verticalAlign: '-2px' }} /> : null}
          {h.kind === 'pdf' ? <Paperclip size={14} style={{ verticalAlign: '-2px' }} /> : null}{' '}
          {h.title}
          {h.fileCount > 1 ? ` (${h.fileCount} pictures)` : ''}
        </b>
        <ToolButton
          label="Open it large, in its own window"
          onClick={() => void handoutViewOpen(h.id)}
        >
          <Maximize2 size={14} />
        </ToolButton>
        {dm && (
          <span className="vtt-form-row">
            {isShared(h) ? (
              <ToolButton
                label="Hide it from the players"
                onClick={() => act(`handouts/${h.id}/hide`)}
              >
                <EyeOff size={14} />
              </ToolButton>
            ) : (
              <ToolButton
                label="Show it to all players"
                onClick={() => act(`handouts/${h.id}/show`)}
              >
                <Eye size={14} />
              </ToolButton>
            )}
            <ToolButton label="Remove this handout…" danger onClick={() => setConfirming(true)}>
              <Trash2 size={14} />
            </ToolButton>
          </span>
        )}
      </div>
      {confirming && (
        <div className="vtt-warning" role="alert">
          <span>{warning ?? 'Remove this handout? Only you have seen it.'}</span>
          <span className="vtt-form-row">
            <ToolButton label="Yes, remove it" danger text="Remove" onClick={() => remove(h)}>
              <Trash2 size={14} />
            </ToolButton>
            <ToolButton label="Keep it" onClick={() => setConfirming(false)}>
              <X size={14} />
            </ToolButton>
          </span>
        </div>
      )}
      {h.kind === 'text' && h.body && <MarkdownView text={h.body} />}
      {h.body && h.kind !== 'text' && <p className="vtt-viewer-caption">{h.body}</p>}
      {(h.kind === 'image' || h.kind === 'map') && h.hasFile && (
        <Picture id={h.id} title={h.title} count={h.fileCount} />
      )}
      {h.kind === 'pdf' && (
        <span className="vtt-muted">
          <Paperclip size={12} style={{ verticalAlign: '-1px' }} /> A PDF: open it from its card in
          chat, or with the open button above.
        </span>
      )}
    </article>
  );
}

/** The DM's way to make a handout: a note, a set of pictures (up to twelve), or one PDF, each with a title. */
function NewHandout({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<NewHandoutMode>('note');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [pictures, setPictures] = useState<File[]>([]);
  const [pdf, setPdf] = useState<File>();
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);
  const pdfChooser = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = pictures.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [pictures]);

  function takePictures(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setMode('pictures');
    setPictures((old) => [...old, ...images].slice(0, MAX_PICTURES));
    setTitle((t) => t || pastedTitle(new Date()));
  }

  /** Reads the picture straight from the system clipboard (the webview's own paste is unreliable for images). */
  async function pasteFromClipboard(quiet = false) {
    try {
      const png = await clipboardPicture();
      if (png) takePictures([fileFromBase64(png, 'image/png', 'pasted.png')]);
      else if (!quiet) onError('There is no picture on the clipboard.');
    } catch (e) {
      if (!quiet) onError(accountErrorMessage(e));
    }
  }

  // Ctrl+V anywhere in the window: use the webview's paste if it carries a picture, else ask Rust.
  useEffect(() => {
    let handled = false;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromClipboard(e.clipboardData?.items ?? [], e.clipboardData?.files);
      if (file) {
        handled = true;
        takePictures([file]);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return;
      handled = false;
      window.setTimeout(() => {
        if (!handled) void pasteFromClipboard(true);
      }, 150);
    };
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('keydown', onKey);
    };
    // `takePictures` and `pasteFromClipboard` only set state; the listeners must not be rebuilt on every keystroke.
  }, []);

  async function create() {
    setBusy(true);
    try {
      if (mode === 'note') {
        await campaignApi('POST', 'handouts', { title: title.trim(), text });
      } else {
        const files = mode === 'pdf' ? (pdf ? [pdf] : []) : pictures;
        const [first, ...rest] = files;
        if (!first) return;
        const made = await handoutUpload(
          title.trim(),
          mode === 'pdf' ? 'pdf' : 'image',
          first.name || 'upload',
          await fileToBase64(first),
        );
        const id = made.handout.id;
        let added = 1;
        try {
          for (const file of rest) {
            await handoutAddImage(id, file.name || 'upload', await fileToBase64(file));
            added += 1;
          }
          if (caption.trim() !== '') {
            await campaignApi('PATCH', `handouts/${id}`, { text: caption.trim() });
          }
        } catch (e) {
          onError(
            `Added ${added} of ${files.length} pictures (the handout is saved as a draft): ${accountErrorMessage(e)}`,
          );
          onDone();
          return;
        }
      }
      setTitle('');
      setText('');
      setCaption('');
      setPictures([]);
      setPdf(undefined);
      onDone();
    } catch (e) {
      onError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = canCreateHandout({
    mode,
    title,
    text,
    pictures: pictures.length,
    hasPdf: pdf !== undefined,
  });
  return (
    <section
      className="vtt-workbench"
      aria-label="New handout"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files];
        if (files.some((f) => f.type.startsWith('image/'))) {
          e.preventDefault();
          takePictures(files);
        }
      }}
    >
      <div className="vtt-form-row">
        <ToolButton
          label="A written note (Markdown)"
          pressed={mode === 'note'}
          onClick={() => setMode('note')}
        >
          <FileText size={14} />
        </ToolButton>
        <ToolButton
          label="Pictures or maps (up to twelve): paste, drop, or choose files"
          pressed={mode === 'pictures'}
          onClick={() => setMode('pictures')}
        >
          <ImagePlus size={14} />
        </ToolButton>
        <ToolButton label="A PDF document" pressed={mode === 'pdf'} onClick={() => setMode('pdf')}>
          <Paperclip size={14} />
        </ToolButton>
        <input
          className="vtt-input"
          style={{ flex: 1, minWidth: 120 }}
          aria-label="Title"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      {mode === 'note' && <MarkdownEditor value={text} onChange={setText} />}
      {mode !== 'note' && (
        <input
          className="vtt-input"
          aria-label="Caption"
          placeholder="A line to go with it (optional)"
          maxLength={300}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      )}
      {mode === 'pictures' && (
        <div className="vtt-dropzone">
          {previews.length > 0 ? (
            <div className="vtt-thumbs">
              {previews.map((src, i) => (
                <span key={src} className="vtt-thumb">
                  <img src={src} alt={`Picture ${i + 1}`} />
                  <button
                    type="button"
                    aria-label={`Remove picture ${i + 1}`}
                    onClick={() => setPictures((old) => old.filter((_, j) => j !== i))}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="vtt-muted">
              Paste pictures here (Ctrl+V), drop them, or choose files.
            </span>
          )}
          <input
            ref={chooser}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              takePictures([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <div className="vtt-form-row">
            <ToolButton
              label="Paste a picture from the clipboard"
              text="Paste"
              disabled={pictures.length >= MAX_PICTURES}
              onClick={() => void pasteFromClipboard()}
            >
              <ClipboardPaste size={14} />
            </ToolButton>
            <ToolButton
              label="Choose files"
              disabled={pictures.length >= MAX_PICTURES}
              onClick={() => chooser.current?.click()}
            >
              <ImagePlus size={14} />
            </ToolButton>
            {pictures.length > 0 && (
              <span className="vtt-muted">
                {pictures.length} of {MAX_PICTURES}
              </span>
            )}
          </div>
        </div>
      )}
      {mode === 'pdf' && (
        <div className="vtt-dropzone">
          <span className="vtt-muted">{pdf ? pdf.name : 'Choose a PDF (10 MB at most).'}</span>
          <input
            ref={pdfChooser}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              setPdf(e.target.files?.[0]);
              setTitle((t) => t || e.target.files?.[0]?.name.replace(/\.pdf$/i, '') || '');
              e.target.value = '';
            }}
          />
          <div className="vtt-form-row">
            <ToolButton label="Choose a PDF" onClick={() => pdfChooser.current?.click()}>
              <Paperclip size={14} />
            </ToolButton>
          </div>
        </div>
      )}
      <div className="vtt-form-row">
        <ToolButton
          label="Add the handout (only you can see it until you show it)"
          disabled={!ready || busy}
          text="Add"
          onClick={() => void create()}
        >
          <Plus size={14} />
        </ToolButton>
      </div>
    </section>
  );
}

export function HandoutsPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const { data, error, reload } = useCampaignQuery<{ handouts: Handout[] }>('handouts', [
    'handout.',
  ]);
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<string>();
  const shown = useMemo(() => searchHandouts(data?.handouts ?? [], query), [data, query]);

  async function act(path: string) {
    try {
      setActionError(undefined);
      await campaignApi('POST', path, path.endsWith('/show') ? { to: 'all' } : {});
      reload();
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  async function remove(h: Handout) {
    try {
      setActionError(undefined);
      await campaignApi('DELETE', `handouts/${h.id}`);
      reload();
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  const problem = error ?? actionError;
  return (
    <div className="vtt-sessions">
      <h2 className="vtt-head">Handouts</h2>
      {problem && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {problem}
        </div>
      )}
      {dm && <NewHandout onDone={reload} onError={setActionError} />}
      {(data?.handouts.length ?? 0) > 0 && (
        <div className="vtt-form-row">
          <Search size={14} aria-hidden />
          <input
            className="vtt-input"
            style={{ flex: 1 }}
            aria-label="Search handouts"
            placeholder="Search handouts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {data && shown.length === 0 && (
        <span className="vtt-muted">
          {data.handouts.length === 0 ? 'Nothing has been shared yet.' : 'No handout matches.'}
        </span>
      )}
      {shown.map((h) => (
        <Item key={h.id} h={h} dm={dm} act={(p) => void act(p)} remove={(x) => void remove(x)} />
      ))}
    </div>
  );
}
