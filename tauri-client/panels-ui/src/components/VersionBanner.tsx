import { useEffect, useState } from 'react';

import { useVersionCheck } from '../hooks/useVersionCheck.js';
import {
  accountErrorMessage,
  onSessionSignedOut,
  updateCheck,
  updateInstall,
} from '../lib/tauriBridge.js';
import { INCOMPATIBLE_WARNING, versionWarning } from '../lib/versionWarning.js';

/**
 * Warns when the app and the server are on different MAJOR.MINOR versions. Same strip as UpdateBanner.
 * Dismissing lasts until the app restarts. When the app is the older side the strip can fetch the
 * update from the server itself; nothing installs until it is pressed.
 */
export function VersionBanner() {
  const check = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    const off = onSessionSignedOut((reason) => {
      if (reason === 'incompatible-server') setRefused(true);
    });
    return () => void off.then((fn) => fn());
  }, []);
  const warning = refused ? INCOMPATIBLE_WARNING : versionWarning(check);
  if (!warning || dismissed) return null;

  const update = async () => {
    setBusy(true);
    setNote(undefined);
    try {
      if (await updateCheck())
        await updateInstall(); // restarts the app on success
      else setNote('Your server has no newer app yet. Ask your DM.');
    } catch (e) {
      setNote(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vtt-update" role="status">
      <span>{note ?? warning}</span>
      {(refused || check?.relation === 'appOlder') && (
        <button type="button" className="vtt-pill" disabled={busy} onClick={() => void update()}>
          {busy ? 'Updating…' : 'Update now'}
        </button>
      )}
      <button type="button" className="vtt-pill" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </div>
  );
}
