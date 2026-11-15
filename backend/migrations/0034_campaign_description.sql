-- A campaign's description: markdown the DM writes, shown to members in the app and on the invite page.
-- The 4,000 limit is counted in characters (code points), matching CAMPAIGN_DESCRIPTION_MAX in the backend.
ALTER TABLE campaigns
  ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000);
