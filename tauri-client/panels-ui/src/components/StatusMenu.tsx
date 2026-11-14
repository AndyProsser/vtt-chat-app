import type { Status } from '../lib/statusStore.js';

/** The coloured dot for a status: green online, amber away, grey offline. */
export function StatusDot({ status }: { status: Status }) {
  return <span className="vtt-status-dot" data-status={status} aria-hidden="true" />;
}
