/** The preview pane of the note and session editors: what to show for the text typed so far. */
export type Preview = { kind: 'empty' } | { kind: 'text'; text: string };

export function previewOf(text: string): Preview {
  return text.trim() === '' ? { kind: 'empty' } : { kind: 'text', text };
}
