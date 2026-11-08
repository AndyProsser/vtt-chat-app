import { getVersion } from '@tauri-apps/api/app';
import { useEffect, useState } from 'react';

import { readMonitorPref, writeMonitorPref } from '../../lib/monitorPref.js';
import { useUpdate } from '../../hooks/useUpdate.js';
import { updateMessage } from '../../lib/updateInfo.js';

import {
  accountErrorMessage,
  autostartEnabled,
  autostartSet,
  soundboardMonitorSet,
} from '../../lib/tauriBridge.js';

/** Start with the computer. Off until chosen; started at login it opens to the tray only. */
export function GeneralSection() {
  const [enabled, setEnabled] = useState<boolean>();
  const [error, setError] = useState<string>();
  const update = useUpdate(false);
  const [monitor, setMonitor] = useState(readMonitorPref);
  const [version, setVersion] = useState<string>();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    void getVersion().then(setVersion, () => undefined);
  }, []);
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
      <label
        className="vtt-volume"
        title="DM only: everyone else already hears effects through the call"
      >
        <input
          type="checkbox"
          checked={monitor}
          onChange={(e) => {
            setMonitor(e.target.checked);
            writeMonitorPref(e.target.checked);
            void soundboardMonitorSet(e.target.checked).catch(() => undefined);
          }}
        />
        DM: hear sound effects on my own speakers too (turn off if you use speakers)
      </label>
      <div className="vtt-drawer-row">
        <span className="vtt-muted">VTT Chat {version ?? ''}</span>
        <button
          type="button"
          className="vtt-pill"
          disabled={update.busy !== undefined}
          onClick={() => void update.check(true).then(() => setChecked(true))}
        >
          {update.busy === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
        {update.available && (
          <button type="button" className="vtt-pill" onClick={() => void update.install()}>
            Restart to update
          </button>
        )}
      </div>
      {update.available && <span>{updateMessage(update.available)}</span>}
      {checked && !update.available && !update.error && (
        <span className="vtt-muted">You are up to date.</span>
      )}
      {update.error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {update.error}
        </div>
      )}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
    </div>
  );
}
