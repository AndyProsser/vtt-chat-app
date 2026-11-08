-- The party inventory: coin as its own kind, who an item was grabbed for, and a coin split.
-- `claimed_for` is 'self', 'party' (kept in the shared pool, marked who took it) or 'split'.
-- `split` is {shares: [{userId, amount}], remainder} for a split coin pile, set in the same single
-- conditional UPDATE as the claim, so a pile is claimed or split exactly once.
ALTER TABLE loot_items
  ADD COLUMN kind        TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item', 'coin')),
  ADD COLUMN claimed_for TEXT CHECK (claimed_for IN ('self', 'party', 'split')),
  ADD COLUMN split       JSONB;
