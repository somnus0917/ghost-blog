CREATE INDEX IF NOT EXISTS post_presence_last_seen_idx
    ON post_presence (last_seen);
