import { ImagePlus } from 'lucide-react';
import { useState } from 'react';

import { shrinkToSquare } from '../lib/avatarImages.js';
import { accountErrorMessage, avatarUpload } from '../lib/tauriBridge.js';

/** Pick a picture; it is shrunk to a 256-pixel square here, uploaded, and its id handed back. */
export function PictureButton({ onPicked }: { onPicked: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      setBusy(true);
      setError(undefined);
      const { id } = await avatarUpload(await shrinkToSquare(file));
      onPicked(id);
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <label className="vtt-tool" title="Upload a picture">
        <ImagePlus size={14} aria-hidden />
        <span>{busy ? 'Uploading…' : 'Picture'}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          disabled={busy}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {error && (
        <span className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </span>
      )}
    </>
  );
}
