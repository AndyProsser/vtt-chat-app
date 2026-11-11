const MAX_DEVICE_LABEL = 80;

/**
 * A device label comes from unauthenticated input (a body field or the `x-device-label` header) and
 * is later shown to people and stored on sessions, so it is stripped of control characters, trimmed
 * and capped. Returns `undefined` when nothing is left.
 */
export function cleanDeviceLabel(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const capped = [...cleaned].slice(0, MAX_DEVICE_LABEL).join('').trim();
  return capped === '' ? undefined : capped;
}
