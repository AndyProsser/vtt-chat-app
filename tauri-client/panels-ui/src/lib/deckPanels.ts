export type PanelName = 'voice' | 'stingers' | 'scenes';
export type DeckPanels = Record<PanelName, boolean>;

/** First time: Voice alone, so the drawer is small. */
export const DEFAULT_PANELS: DeckPanels = { voice: true, stingers: false, scenes: false };

/** Reads what was saved; a missing, damaged or foreign value falls back field by field. */
export function parsePanels(raw: string | null): DeckPanels {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : undefined;
  } catch {
    value = undefined;
  }
  const saved =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const pick = (name: PanelName) =>
    typeof saved[name] === 'boolean' ? (saved[name] as boolean) : DEFAULT_PANELS[name];
  return { voice: pick('voice'), stingers: pick('stingers'), scenes: pick('scenes') };
}

export const togglePanel = (panels: DeckPanels, name: PanelName): DeckPanels => ({
  ...panels,
  [name]: !panels[name],
});
