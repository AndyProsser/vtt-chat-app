/** Whether the webview is on screen. A hidden window must run no timers (STATE-AND-RESILIENCE.md). */
export function isPageVisible(doc: Document = document): boolean {
  return doc.visibilityState !== 'hidden';
}

/** Calls `onChange` with the new visibility each time it flips; returns the unsubscribe. */
export function watchPageVisibility(
  doc: Document,
  onChange: (visible: boolean) => void,
): () => void {
  const handler = () => onChange(isPageVisible(doc));
  doc.addEventListener('visibilitychange', handler);
  return () => doc.removeEventListener('visibilitychange', handler);
}
