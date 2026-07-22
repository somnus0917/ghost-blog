CREATE TABLE IF NOT EXISTS post_likes (
    post_uuid TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_uuid, visitor_hash)
);

CREATE INDEX IF NOT EXISTS post_likes_post_uuid_idx
    ON post_likes (post_uuid);

CREATE TABLE IF NOT EXISTS post_presence (
    post_uuid TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (post_uuid, visitor_hash)
);

CREATE INDEX IF NOT EXISTS post_presence_active_idx
    ON post_presence (post_uuid, last_seen);
