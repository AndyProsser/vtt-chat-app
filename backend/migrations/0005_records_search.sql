-- Full-text search over a campaign's history (transcripts and summaries). English stemming; the
-- queries use plainto_tsquery so user input can never be interpreted as query syntax.
CREATE INDEX transcript_segments_fts_idx ON transcript_segments USING GIN (to_tsvector('english', text));
CREATE INDEX summaries_fts_idx ON summaries USING GIN (to_tsvector('english', text));
