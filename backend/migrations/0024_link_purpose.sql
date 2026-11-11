-- A signed-in browser can issue a short-lived 'link' code for the desktop app.
ALTER TABLE magic_links DROP CONSTRAINT magic_links_purpose_check;
ALTER TABLE magic_links ADD CONSTRAINT magic_links_purpose_check CHECK (purpose IN ('signin', 'reset', 'link'));
