-- "Added to my sheet" (protocol 4): a held item is confirmed once its holder has put it on their real game sheet.
-- One flag for an item a player holds or the party stash; a split pile keeps one per share, inside `split`
-- (shares[].confirmed). Every move resets it (set in the same UPDATEs that move the item).
ALTER TABLE loot_items ADD COLUMN confirmed BOOLEAN NOT NULL DEFAULT FALSE;
