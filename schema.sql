-- TempMail D1 schema
-- Run: npm run db:init   (wrangler d1 execute tempmail --remote --file schema.sql)

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  address     TEXT NOT NULL,
  from_addr   TEXT,
  from_name   TEXT,
  subject     TEXT,
  text_body   TEXT,
  html_body   TEXT,
  received_at INTEGER NOT NULL,
  is_read     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_address_received
  ON messages (address, received_at DESC);

-- Every name ever created (Random or Custom) is recorded here forever.
-- Random generation never reuses a local_part from this table, and a row
-- with retired = 1 is a permanent blocklist entry: the name can never be
-- generated or manually re-created again.
CREATE TABLE IF NOT EXISTS used_names (
  local_part TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0
);
