-- Photos of work done on real clients. A photo only reaches the website when
-- the client has agreed to it, and that agreement is recorded here.
CREATE TABLE IF NOT EXISTS gallery (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  service_id  TEXT,
  service     TEXT NOT NULL DEFAULT '',
  caption     TEXT NOT NULL DEFAULT '',
  img_key     TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',      -- staff reference only, never public
  consent     INTEGER NOT NULL DEFAULT 0,    -- the client agreed we may show it
  consent_note TEXT NOT NULL DEFAULT '',     -- how and when they agreed
  published   INTEGER NOT NULL DEFAULT 0,
  featured    INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gallery_public ON gallery(published, consent, sort);
