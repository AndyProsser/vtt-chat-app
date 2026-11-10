import { DropdownMenu } from '@radix-ui/themes';

import { useStatus } from '../hooks/useStatus.js';
import { STATUS_HINTS, STATUS_LABELS, STATUSES } from '../lib/status.js';
import type { Status } from '../lib/statusStore.js';
import { ToolButton } from './ToolButton.js';

/** The coloured dot for a status: green online, amber away, grey offline. */
export function StatusDot({ status }: { status: Status }) {
  return <span className="vtt-status-dot" data-status={status} aria-hidden="true" />;
}

/**
 * The status control, right of the settings cog: a dot that opens Online / Away / Offline. Online joins
 * voice, Away keeps you in the room with the microphone closed, Offline leaves voice (chat stays on).
 */
export function StatusMenu() {
  const { status, busy, error, change } = useStatus();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <ToolButton
          label={error ?? `Status: ${STATUS_LABELS[status]}`}
          disabled={busy}
          className="vtt-status-trigger"
        >
          <StatusDot status={status} />
        </ToolButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content size="1" align="end">
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
