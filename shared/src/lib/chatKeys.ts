/** The bits of a keyboard event the composer rule needs (a DOM or React event fits). */
export interface ComposerKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/**
 * What the chat box does with a key: `send` (Enter), `newline` (Ctrl or Cmd+Enter, which a browser does not turn into a
 * line break by itself, so the caller inserts it with {@link insertNewline}), or `native` (let the browser act:
 * Shift+Enter is already a new line, and everything else is typing). On a touch device (`coarsePointer`) a bare Enter is
 * a new line and the Send button sends. Enter that confirms an IME composition is never a send.
 */
export function composerKeyAction(
  e: ComposerKey,
  coarsePointer: boolean,
): 'send' | 'newline' | 'native' {
  if (e.key !== 'Enter' || e.isComposing) return 'native';
  if (e.ctrlKey || e.metaKey) return 'newline';
  if (e.shiftKey) return 'native';
  return coarsePointer ? 'native' : 'send';
}

/** `value` with a line break replacing the selection `start..end`, and where the caret goes afterwards. */
export function insertNewline(
  value: string,
  start: number,
  end: number,
): { value: string; caret: number } {
  return { value: `${value.slice(0, start)}\n${value.slice(end)}`, caret: start + 1 };
}
