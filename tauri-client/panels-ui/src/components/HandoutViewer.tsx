import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
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
import { ImageZoom } from './ImageZoom.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { MarkdownView } from './MarkdownView.js';
import { ToolButton } from './ToolButton.js';

/**
 * One handout, large, in a window of its own (opened from its card in chat). Players read it; the DM can
 * also edit it. Pictures get zoom controls here, and only here.
 */
export function HandoutViewer() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const [id, setId] = useState(() => handoutIdFromHash(window.location.hash));
  const [handout, setHandout] = useState<Handout>();
  const [picture, setPicture] = useState<string>();
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
    setPicture(undefined);
    setError(undefined);
    campaignApi<{ handout: Handout }>('GET', `handouts/${id}`)
      .then(async ({ handout: h }) => {
        if (cancelled) return;
        setHandout(h);
        if ((h.kind === 'image' || h.kind === 'map') && h.hasFile) {
          const src = await campaignFile(`handouts/${id}/file`);
          if (!cancelled) setPicture(src);
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
      const body = handout.kind === 'text' ? { title, text } : { title };
      const { handout: next } = await campaignApi<{ handout: Handout }>(
        'PATCH',
        `handouts/${handout.id}`,
        body,
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
          {handout.kind === 'text' &&
            (editing ? (
              <MarkdownEditor value={text} onChange={setText} />
            ) : (
              <MarkdownView text={handout.body ?? ''} />
            ))}
          {(handout.kind === 'image' || handout.kind === 'map') && picture && (
            <ImageZoom src={picture} alt={handout.title} />
          )}
          {handout.kind === 'pdf' && (
            <span className="vtt-muted">A PDF — open it from the web page.</span>
          )}
        </>
      )}
    </div>
  );
}
