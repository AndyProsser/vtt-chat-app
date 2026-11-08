import {
  ClipboardPaste,
  Eye,
  EyeOff,
  FileText,
  ImagePlus,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import {
  fileFromBase64,
  fileToBase64,
  imageFromClipboard,
  isShared,
  pastedTitle,
  removalWarning,
  searchHandouts,
} from '../lib/handoutTools.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import {
  accountErrorMessage,
  campaignApi,
  campaignFile,
  clipboardPicture,
  handoutUpload,
} from '../lib/tauriBridge.js';
import type { Handout } from '../types/index.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { MarkdownView } from './MarkdownView.js';
import { ToolButton } from './ToolButton.js';

function Picture({ id, title }: { id: string; title: string }) {
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    campaignFile(`handouts/${id}/file`)
      .then((s) => !cancelled && setSrc(s))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (failed) return <span className="vtt-muted">Could not load the picture.</span>;
  return src ? <img src={src} alt={title} className="vtt-handout-img" /> : null;
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
          {h.kind === 'text' ? <FileText size={14} style={{ verticalAlign: '-2px' }} /> : null}{' '}
          {h.title}
        </b>
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
      {(h.kind === 'image' || h.kind === 'map') && h.hasFile && (
        <Picture id={h.id} title={h.title} />
      )}
      {h.kind === 'pdf' && <span className="vtt-muted">A PDF — open it from the web page.</span>}
    </article>
  );
}

/** The DM's way to make a handout: write one in Markdown, or paste (or choose) a picture. */
function NewHandout({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<'note' | 'picture'>('note');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [picture, setPicture] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picture) return setPreview(undefined);
    const url = URL.createObjectURL(picture);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);

  function take(file: File | undefined) {
    if (!file) return;
    setPicture(file);
    setMode('picture');
    setTitle((t) => t || pastedTitle(new Date()));
  }

  /** Reads the picture straight from the system clipboard (the webview's own paste is unreliable for images). */
  async function pasteFromClipboard(quiet = false) {
    try {
      const png = await clipboardPicture();
      if (png) take(fileFromBase64(png, 'image/png', 'pasted.png'));
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
        take(file);
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
    // `take` and `pasteFromClipboard` only set state; the listeners must not be rebuilt on every keystroke.
  }, []);

  async function create() {
    setBusy(true);
    try {
      if (mode === 'picture' && picture) {
        await handoutUpload(
          title.trim(),
          'image',
          picture.name || 'pasted.png',
          await fileToBase64(picture),
        );
      } else {
        await campaignApi('POST', 'handouts', { title: title.trim(), text });
      }
      setTitle('');
      setText('');
      setPicture(undefined);
      onDone();
    } catch (e) {
      onError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    title.trim() !== '' && (mode === 'picture' ? picture !== undefined : text.trim() !== '');
  return (
    <section
      className="vtt-workbench"
      aria-label="New handout"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
        if (file) {
          e.preventDefault();
          take(file);
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
          label="A picture or map: paste it, drop it here, or choose a file"
          pressed={mode === 'picture'}
          onClick={() => setMode('picture')}
        >
          <ImagePlus size={14} />
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
      {mode === 'note' ? (
        <MarkdownEditor value={text} onChange={setText} />
      ) : (
        <div className="vtt-dropzone">
          {preview ? (
            <img src={preview} alt="The picture to add" className="vtt-handout-img" />
          ) : (
            <span className="vtt-muted">
              Paste a picture here (Ctrl+V), drop one, or choose a file.
            </span>
          )}
          <input
            ref={chooser}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => take(e.target.files?.[0])}
          />
          <div className="vtt-form-row">
            <ToolButton
              label="Paste the picture from the clipboard"
              text="Paste"
              onClick={() => void pasteFromClipboard()}
            >
              <ClipboardPaste size={14} />
            </ToolButton>
            <ToolButton label="Choose a file" onClick={() => chooser.current?.click()}>
              <ImagePlus size={14} />
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
