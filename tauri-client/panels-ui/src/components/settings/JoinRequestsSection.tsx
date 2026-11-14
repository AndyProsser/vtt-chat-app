import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { avatarColor } from '../../lib/avatarColor.js';
import {
  joinErrorMessage,
  pendingCount,
  relativeTime,
  sortRequests,
} from '../../lib/joinRequests.js';
import { useJoinStore } from '../../lib/joinStore.js';
import { joinAllow } from '../../lib/tauriBridge.js';
import { initials } from '../../lib/rail.js';
import type { JoinRequestRow } from '../../types/index.js';
import { Portrait } from '../Portrait.js';
import { ToolButton } from '../ToolButton.js';
import { Switch } from '@radix-ui/themes';
import { SectionHeading } from './SectionHeading.js';
import { SettingRow } from './SettingRow.js';

/**
 * The DM's side of "ask to join": the Allow join switch, the people waiting, and recent answers. The
 * store is fed by `useJoinFeed` (a read on open, then live frames); this view reads it again when it
 * opens so a Settings window of its own is never stale, and polls nothing.
 */
export function JoinRequestsSection({ campaignId }: { campaignId: string }) {
  const inbox = useJoinStore((s) => s.inbox);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void useJoinStore
      .getState()
      .load(campaignId)
      .catch(() => undefined);
  }, [campaignId]);

  const rows = sortRequests(inbox.requests);
  const waiting = rows.filter((r) => r.status === 'pending');
  const recent = rows.filter((r) => r.status !== 'pending').slice(0, 8);
  const now = Date.now();

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(joinErrorMessage(e));
      void useJoinStore
        .getState()
        .load(campaignId)
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vtt-settings-section">
      <SectionHeading
        title={`Join requests${pendingCount(inbox) > 0 ? ` (${pendingCount(inbox)})` : ''}`}
        hint="People who found your table and asked to join."
      />
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      <div className="vtt-set-card">
        <SettingRow
          label="Allow join"
          hint="When off, your table is hidden from the list and takes no requests."
        >
          <Switch
            aria-label="Allow join"
            checked={inbox.allowJoin}
            disabled={busy}
            onCheckedChange={(on) =>
              void run(async () => {
                await joinAllow(campaignId, on);
                useJoinStore.getState().setAllow(on);
              })
            }
          />
        </SettingRow>
        {waiting.length === 0 && recent.length === 0 && (
          <span className="vtt-muted">No requests yet.</span>
        )}
        {waiting.map((r) => (
          <RequestRow key={r.id} row={r} now={now}>
            <ToolButton
              label={r.closed ? 'Turn Allow join on to approve' : 'Approve'}
              disabled={busy || r.closed}
              onClick={() => void run(() => useJoinStore.getState().decide(campaignId, r.id, true))}
            >
              <Check size={14} />
            </ToolButton>
            <ToolButton
              label="Decline"
              danger
              disabled={busy}
              onClick={() =>
                void run(() => useJoinStore.getState().decide(campaignId, r.id, false))
              }
            >
              <X size={14} />
            </ToolButton>
          </RequestRow>
        ))}
        {recent.map((r) => (
          <RequestRow key={r.id} row={r} now={now} />
        ))}
      </div>
    </div>
  );
}

function RequestRow({
  row,
  now,
  children,
}: {
  row: JoinRequestRow;
  now: number;
  children?: React.ReactNode;
}) {
  const answered = row.status !== 'pending';
  return (
    <div className="vtt-join-row vtt-join-person">
      <span
        className="vtt-av vtt-join-av"
        style={{ background: avatarColor(row.userId) }}
        aria-hidden
      >
        <Portrait avatarUrl={row.avatarUrl} fallback={initials(row.displayName)} />
      </span>
      <div className="vtt-join-who">
        <b>{row.displayName}</b>
        <span className="vtt-muted">
          {answered
            ? `${row.status === 'approved' ? 'Approved' : 'Declined'} ${relativeTime(row.decidedAt ?? row.createdAt, now)}`
            : relativeTime(row.createdAt, now)}
          {!answered && row.closed && ' · Allow join is off'}
        </span>
        {row.message && <span className="vtt-join-msg">{row.message}</span>}
      </div>
      {children && <div className="vtt-join-actions">{children}</div>}
    </div>
  );
}
