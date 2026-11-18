import { Select, TextField } from '@radix-ui/themes';
import { Check, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { fileToBase64 } from '../../lib/handoutTools.js';
import {
  boardWithSound,
  CATEGORY_LABEL,
  clipProblem,
  nameFromFile,
  ownSounds,
  type ClipCategory,
} from '../../lib/mySounds.js';
import { accountErrorMessage, campaignApi, soundUpload } from '../../lib/tauriBridge.js';
import type { SoundBoard, SoundRecord } from '../../types/index.js';
import { ToolButton } from '../ToolButton.js';

const ACCEPT = '.ogg,.wav,.mp3,.flac,audio/ogg,audio/wav,audio/mpeg,audio/flac';

/**
 * The DM's own sounds: add a clip (an effect also lands on the Stingers by itself), add another take so a button
 * does not repeat, rename, change its kind, or delete it. The catalogue that ships with the server is not listed:
 * it is not the DM's to change.
 */
export function MySounds({
  sounds,
  boards,
  onChanged,
}: {
  sounds: SoundRecord[];
  boards: SoundBoard[];
  onChanged: () => void;
}) {
  const own = ownSounds(sounds);
  const [picked, setPicked] = useState<File>();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ClipCategory>('effect');
  const [takeFor, setTakeFor] = useState<string>();
  const [renaming, setRenaming] = useState<{ id: string; text: string }>();
  const [confirming, setConfirming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onFile(chosen: File | undefined) {
    if (file.current) file.current.value = '';
    if (!chosen) return;
    const problem = clipProblem(chosen);
    if (problem) {
      setError(problem);
      setTakeFor(undefined);
      return;
    }
    setError(undefined);
    if (takeFor) {
      const id = takeFor;
      setTakeFor(undefined);
      void run(async () => {
        await soundUpload({
          soundId: id,
          name: '',
          category: 'effect',
          filename: chosen.name,
          data: await fileToBase64(chosen),
        });
      });
      return;
    }
    setPicked(chosen);
    setName(nameFromFile(chosen.name));
  }

  function upload() {
    const chosen = picked;
    if (!chosen) return;
    void run(async () => {
      const { sound } = await soundUpload({
        name: name.trim(),
        category,
        filename: chosen.name,
        data: await fileToBase64(chosen),
      });
      // An effect needs a button to be played from the Stingers; loops and music are chosen in scenes.
      const plan = category === 'effect' ? boardWithSound(boards, sound) : undefined;
      if (plan) {
        await campaignApi(
          plan.id ? 'PUT' : 'POST',
          plan.id ? `soundboard/boards/${plan.id}` : 'soundboard/boards',
          plan.body,
        );
      }
      setPicked(undefined);
    });
  }

  return (
    <div className="vtt-set-pane">
      <div className="vtt-set-head">
        <span className="vtt-set-sub">My sounds</span>
        <ToolButton
          label="Add a sound"
          text="Add"
          disabled={busy}
          onClick={() => {
            setTakeFor(undefined);
            file.current?.click();
          }}
        >
          <Plus size={14} />
        </ToolButton>
      </div>
      <input
        ref={file}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label="Choose a sound file"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {picked && (
        <div className="vtt-set-item">
          <TextField.Root
            size="1"
            style={{ flex: 1, minWidth: 100 }}
            aria-label="Sound name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select.Root value={category} onValueChange={(v) => setCategory(v as ClipCategory)}>
            <Select.Trigger aria-label="Kind of sound" />
            <Select.Content position="popper" sideOffset={4} className="vtt-dropdown">
              {(Object.keys(CATEGORY_LABEL) as ClipCategory[]).map((c) => (
                <Select.Item key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <ToolButton
            label="Upload"
            text="Upload"
            disabled={busy || name.trim() === ''}
            onClick={upload}
          >
            <Upload size={14} />
          </ToolButton>
          <ToolButton label="Cancel" onClick={() => setPicked(undefined)}>
            <X size={14} />
          </ToolButton>
        </div>
      )}
      <small className="vtt-muted">
        OGG, WAV, MP3 or FLAC, up to 5 MB. An effect appears under Stingers; ambience and music are
        chosen in a scene.
      </small>
      {own.length === 0 && !picked && <span className="vtt-muted">No sounds of your own yet.</span>}
      {own.map((s) => (
        <div key={s.id} className="vtt-set-item">
          {renaming?.id === s.id ? (
            <>
              <TextField.Root
                size="1"
                style={{ flex: 1, minWidth: 100 }}
                aria-label={`New name for ${s.name}`}
                value={renaming.text}
                onChange={(e) => setRenaming({ id: s.id, text: e.target.value })}
              />
              <ToolButton
                label="Save name"
                disabled={busy || renaming.text.trim() === ''}
                onClick={() =>
                  void run(async () => {
                    await campaignApi('PATCH', `soundboard/sounds/${s.id}`, {
                      name: renaming.text.trim(),
                    });
                    setRenaming(undefined);
                  })
                }
              >
                <Check size={14} />
              </ToolButton>
              <ToolButton label="Cancel" onClick={() => setRenaming(undefined)}>
                <X size={14} />
              </ToolButton>
            </>
          ) : (
            <>
              <span className="vtt-set-label">
                <span>{s.name}</span>
                <small>
                  {CATEGORY_LABEL[(s.category as ClipCategory) ?? 'effect'] ?? 'Sound'}
                  {s.takes && s.takes.length > 1 ? ` · ${s.takes.length} takes` : ''}
                </small>
              </span>
              {confirming === s.id ? (
                <>
                  <small className="vtt-muted">Delete?</small>
                  <ToolButton
                    label={`Yes, delete ${s.name}`}
                    danger
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await campaignApi('DELETE', `soundboard/sounds/${s.id}`);
                        setConfirming(undefined);
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </ToolButton>
                  <ToolButton label="Keep it" onClick={() => setConfirming(undefined)}>
                    <X size={14} />
                  </ToolButton>
                </>
              ) : (
                <>
                  <ToolButton
                    label={`Add another take of ${s.name}`}
                    disabled={busy}
                    onClick={() => {
                      setTakeFor(s.id);
                      file.current?.click();
                    }}
                  >
                    <Plus size={14} />
                  </ToolButton>
                  <ToolButton
                    label={`Rename ${s.name}`}
                    onClick={() => setRenaming({ id: s.id, text: s.name })}
                  >
                    <Pencil size={14} />
                  </ToolButton>
                  <ToolButton label={`Delete ${s.name}`} danger onClick={() => setConfirming(s.id)}>
                    <Trash2 size={14} />
                  </ToolButton>
                </>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
