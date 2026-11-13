-- A service can carry its own photo, the same way a product does.
ALTER TABLE services ADD COLUMN img_key TEXT NOT NULL DEFAULT '';
