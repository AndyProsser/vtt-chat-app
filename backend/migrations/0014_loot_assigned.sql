-- The DM can hand an item straight to one player: claimed_for gains 'assigned'.
ALTER TABLE loot_items DROP CONSTRAINT loot_items_claimed_for_check;
ALTER TABLE loot_items
  ADD CONSTRAINT loot_items_claimed_for_check CHECK (claimed_for IN ('self', 'party', 'split', 'assigned'));
