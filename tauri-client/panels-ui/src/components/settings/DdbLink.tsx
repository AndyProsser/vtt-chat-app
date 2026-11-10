import { TextField } from '@radix-ui/themes';
import { Link2, RefreshCw, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';

import { looksLikeSheetLink, syncedLabel } from '../../lib/ddbSync.js';
import { accountErrorMessage, ddbAction, ddbStatus } from '../../lib/tauriBridge.js';
import { ToolButton } from '../ToolButton.js';

/** Whether this server has D&D Beyond sync on, asked once per window. */
function useDdbEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    ddbStatus()
      .then((s) => !cancelled && setEnabled(s.enabled))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

/**
 * Links a character to its public D&D Beyond sheet so name, race, class, level and portrait follow it.
 * The server refreshes linked characters on a timer; "Sync now" does it immediately. Hidden when the
 * server operator has not enabled the sync.
 */
export function DdbLink({
  characterId,
  sourceUrl,
  syncedAt,
  onChanged,
}: {
  characterId: string;
  sourceUrl: string | null | undefined;
  syncedAt: number | null | undefined;
  onChanged: () => void;
}) {
  const enabled = useDdbEnabled();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!enabled) return null;

  async function run(action: 'link' | 'sync' | 'unlink', url?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await ddbAction(action, characterId, url);
      setText('');
      onChanged();
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vtt-sessions">
      <b>
        <Link2 size={14} style={{ verticalAlign: '-2px' }} /> D&amp;D Beyond
      </b>
      {sourceUrl ? (
        <>
          <span className="vtt-muted">
            Linked to {sourceUrl.replace('https://www.', '')}.{' '}
            {syncedLabel(syncedAt ?? null, Date.now())}.
          </span>
          <div className="vtt-form-row">
            <ToolButton
              label="Sync now"
              text="Sync"
              disabled={busy}
              onClick={() => void run('sync')}
            >
              <RefreshCw size={14} />
            </ToolButton>
            <ToolButton
              label="Unlink (keeps the character as it is)"
              disabled={busy}
              onClick={() => void run('unlink')}
            >
              <Unlink size={14} />
            </ToolButton>
          </div>
        </>
      ) : (
        <>
          <span className="vtt-muted">
            Paste the link to your character&apos;s sheet (it must be shared publicly on D&amp;D
            Beyond).
          </span>
          <div className="vtt-form-row">
            <TextField.Root
              size="1"
              style={{ flex: 1, minWidth: 140 }}
              aria-label="D&D Beyond character link"
              placeholder="https://www.dndbeyond.com/characters/…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <ToolButton
              label="Link and import"
              text="Link"
              disabled={busy || !looksLikeSheetLink(text)}
              onClick={() => void run('link', text.trim())}
            >
              <Link2 size={14} />
            </ToolButton>
          </div>
        </>
      )}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </div>
  );
}
