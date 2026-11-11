/** Minimal shape of `navigator.clipboard`, so the helper can be tested without a browser. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/**
 * Copies text with the async Clipboard API. Returns false (never throws) when the API is missing,
 * blocked (insecure context, permissions) or fails, so the caller can fall back to selecting the text.
 */
export async function copyText(text: string, clipboard?: ClipboardLike): Promise<boolean> {
  try {
    if (!clipboard) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
