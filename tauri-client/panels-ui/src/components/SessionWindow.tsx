import { splitTaleTitle } from '@vtt-chat-app/shared';
import { useEffect } from 'react';

import { useRecordingSummaries } from '../hooks/useRecordingSummaries.js';
import { sessionIdFromHash, sessionTabFromHash } from '../lib/panelName.js';
import { sessionConfigureWindow } from '../lib/tauriBridge.js';
import { SessionTabs } from './SessionTabs.js';

/**
 * One recorded session in a window of its own (`#session/<id>`, optionally `/<tab>`), opened by the pop-out button in
 * History: the same tabs, so a Game Master can keep a tale or the notes beside the chat. The title bar carries the
 * storyteller's title for the session.
 */
export function SessionWindow() {
  const id = sessionIdFromHash(window.location.hash);
  const tab = sessionTabFromHash(window.location.hash);
  const { summaries, error } = useRecordingSummaries(id);
  const title = summaries
    ? (splitTaleTitle(summaries.find((s) => s.kind === 'session')?.text ?? '').title ??
      'Recorded session')
    : undefined;
  useEffect(() => {
    if (title) void sessionConfigureWindow(title).catch(() => undefined);
  }, [title]);
  return (
    <div className="vtt-settings vtt-panel-pad">
      {!id && <span className="vtt-muted">This is not a session window address.</span>}
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {id && !summaries && !error && <span className="vtt-muted">Loading…</span>}
      {summaries?.length === 0 && (
        <span className="vtt-muted">No summary yet: it appears once processing finishes.</span>
      )}
      {summaries && <SessionTabs summaries={summaries} {...(tab ? { initialTab: tab } : {})} />}
    </div>
  );
}
