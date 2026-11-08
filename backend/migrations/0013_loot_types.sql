-- What a loot item is, for its icon and glow: a type, an SRD-style rarity for magic items, and the
-- SRD item it came from (null for custom items). Older rows stay as plain 'other' items.
ALTER TABLE loot_items
  ADD COLUMN item_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN rarity    TEXT CHECK (rarity IN ('common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact')),
  ADD COLUMN srd_id    TEXT;
UPDATE loot_items SET item_type = 'coin' WHERE kind = 'coin';
