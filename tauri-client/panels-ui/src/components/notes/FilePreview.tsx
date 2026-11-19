import { Dialog } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import { accountErrorMessage, campaignFile } from '../../lib/tauriBridge.js';
import type { GmNoteFile } from '../../types/index.js';
import { ImageZoom } from '../ImageZoom.js';
import { PdfView } from '../PdfView.js';

/** A notes attachment in a window of its own over the notes: a picture with zoom, or a PDF page by page. */
export function FilePreview({ file, onClose }: { file: GmNoteFile | null; onClose: () => void }) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setSrc(undefined);
    setError(undefined);
    if (!file) return;
    let cancelled = false;
    campaignFile(`gm/notes/files/${file.id}`)
      .then((url) => !cancelled && setSrc(url))
      .catch((e) => !cancelled && setError(accountErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [file]);
  return (
    <Dialog.Root open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content maxWidth="min(92vw, 900px)" className="vtt-notes-preview">
        <Dialog.Title size="3">{file?.name ?? ''}</Dialog.Title>
        <Dialog.Description size="1" className="vtt-muted">
          Only you can see this.
        </Dialog.Description>
        {error && <span className="vtt-composer-error">{error}</span>}
        {!error && !src && <span className="vtt-muted">Loading…</span>}
        {src && file?.kind === 'image' && <ImageZoom src={src} alt={file.name} />}
        {src && file?.kind === 'pdf' && <PdfView dataUrl={src} />}
      </Dialog.Content>
    </Dialog.Root>
  );
}
