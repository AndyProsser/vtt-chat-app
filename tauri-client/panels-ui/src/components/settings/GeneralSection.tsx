import { useEffect, useState } from 'react';

import { accountErrorMessage, autostartEnabled, autostartSet } from '../../lib/tauriBridge.js';

/** Start with the computer. Off until chosen; started at login it opens to the tray only. */
export function GeneralSection() {
  const [enabled, setEnabled] = useState<boolean>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void autostartEnabled().then(setEnabled, (e: unknown) => setError(accountErrorMessage(e)));
  }, []);
  return (
    <div className="vtt-inventory" style={{ paddingTop: 12 }}>
      <label className="vtt-volume">
        <input
          type="checkbox"
          disabled={enabled === undefined}
          checked={enabled ?? false}
          onChange={(e) => {
            const next = e.target.checked;
            setError(undefined);
            autostartSet(next).then(
              () => setEnabled(next),
              (err: unknown) => setError(accountErrorMessage(err)),
            );
          }}
        />
        Start VTT Chat when I log in (to the tray, window hidden)
      </label>
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </div>
  );
}
