import { Button, Callout, Flex, Text } from '@radix-ui/themes';
import { GM_NOTES_BODY_MAX, attachmentProblem, editorStart } from '@vtt-chat-app/shared';
import { useEffect, useState } from 'react';

import { useLoad } from '../../hooks/useLoad.js';
import { ApiError } from '../../lib/api.js';
import {
  addGmNoteFile,
  deleteGmNoteFile,
  gmNoteFile,
  gmNotes,
  saveGmNotes,
} from '../../lib/phone/phoneApi.js';
import type { GmNoteFileItem } from '../../types/phone.js';
import { GmNotesView } from './GmNotesView.js';
import { MarkdownField } from './MarkdownField.js';
import { PictureViewer } from './PictureViewer.js';

/**
 * The Game Master's notes on the phone (the same one page, and the same attachments, as the desktop app's notes
 * window; only the Game Master can open it, the server refuses anyone else). Read, edit, attach pictures and PDFs.
 */
export function GmNotesScreen({ campaignId }: { campaignId: string }) {
  const notes = useLoad(() => gmNotes(campaignId), campaignId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [picture, setPicture] = useState<{ url: string; title: string }>();
  const [pdf, setPdf] = useState<{ url: string; name: string }>();

  // A picture is shown from a blob URL; let it go when it is closed or the screen is left.
  useEffect(() => () => picture && URL.revokeObjectURL(picture.url), [picture]);

  const fail = (e: unknown, fallback: string) =>
    setError(e instanceof ApiError ? e.message : fallback);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await saveGmNotes(campaignId, draft);
      notes.reload();
      setEditing(false);
    } catch (e) {
      fail(e, 'Could not save the notes. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function open(file: GmNoteFileItem) {
    setError(undefined);
    setPdf(undefined);
    // A phone only lets a tab open from the tap itself, not after the file has downloaded: open it now, fill it in
    // when the PDF arrives. If the phone refuses even that, the PDF is offered as a link to tap.
    const tab = file.kind === 'pdf' ? window.open('', '_blank') : null;
    try {
      const blob = await gmNoteFile(campaignId, file.id);
      const url = URL.createObjectURL(blob);
      if (file.kind === 'image') return setPicture({ url, title: file.name });
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
      if (tab) tab.location.href = url;
      else setPdf({ url, name: file.name });
    } catch {
      tab?.close();
      setError('Could not open that file.');
    }
  }

  async function attach(file: File) {
    const problem = attachmentProblem(file, notes.data?.maxFileBytes ?? 0);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    try {
      await addGmNoteFile(campaignId, file);
      notes.reload();
    } catch (e) {
      fail(e, 'Could not attach that file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: GmNoteFileItem) {
    setBusy(true);
    setError(undefined);
    try {
      await deleteGmNoteFile(campaignId, file.id);
      notes.reload();
    } catch (e) {
      fail(e, 'Could not delete that file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (notes.loading && !notes.data) return <Text color="gray">Loading the notes…</Text>;
  if (notes.error || !notes.data) {
    return (
      <Callout.Root color="red" role="alert">
        <Callout.Text>{notes.error ?? 'Could not load the notes.'}</Callout.Text>
      </Callout.Root>
    );
  }

  if (editing) {
    return (
      <Flex direction="column" gap="3">
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <MarkdownField
          id="gm-notes"
          label="Your notes"
          value={draft}
          onChange={setDraft}
          max={GM_NOTES_BODY_MAX}
          rows={16}
          placeholder="Anything: the plot, secrets, who is who. Only you can read it."
        />
        <Flex gap="2">
          <Button size="3" loading={busy} onClick={() => void save()}>
            Save
          </Button>
          <Button size="3" variant="soft" color="gray" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </Flex>
      </Flex>
    );
  }

  return (
    <>
      <GmNotesView
        data={notes.data}
        busy={busy}
        error={error}
        onEdit={() => {
          setDraft(editorStart(notes.data?.body ?? ''));
          setError(undefined);
          setEditing(true);
        }}
        onOpenFile={(f) => void open(f)}
        onDeleteFile={(f) => void remove(f)}
        onAttach={(f) => void attach(f)}
      />
      {pdf && (
        <Callout.Root color="gray">
          <Callout.Text>
            <a href={pdf.url} target="_blank" rel="noopener noreferrer">
              Open {pdf.name}
            </a>
          </Callout.Text>
        </Callout.Root>
      )}
      {picture && (
        <PictureViewer
          urls={[picture.url]}
          title={picture.title}
          start={0}
          onClose={() => setPicture(undefined)}
        />
      )}
    </>
  );
}
