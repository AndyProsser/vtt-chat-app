import { DropdownMenu } from '@radix-ui/themes';

import { useStatus } from '../hooks/useStatus.js';
import { STATUS_HINTS, STATUS_LABELS, STATUSES } from '../lib/status.js';
import type { Status } from '../lib/statusStore.js';
import { StatusDot } from './StatusMenu.js';

/**
 * Your status as a colour-coded pill (ONLINE green, AWAY amber, OFFLINE grey) above the mute button; click it for a
 * menu that changes it. Online joins voice, Away keeps you in the room with the microphone closed, Offline leaves
 * voice (chat stays on).
 */
export function StatusPill() {
  const { status, busy, error, change } = useStatus();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button
          type="button"
          className="vtt-pill-status"
          data-status={status}
          disabled={busy}
          title={error ?? `Status: ${STATUS_LABELS[status]}. Click to change it`}
          aria-label={error ?? `Status: ${STATUS_LABELS[status]}. Change it`}
        >
          {STATUS_LABELS[status].toUpperCase()}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" side="top" align="start">
        <DropdownMenu.RadioGroup value={status} onValueChange={(v) => void change(v as Status)}>
          {STATUSES.map((s) => (
            <DropdownMenu.RadioItem key={s} value={s}>
              <StatusDot status={s} /> {STATUS_LABELS[s]}
              <span className="vtt-muted"> · {STATUS_HINTS[s]}</span>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
