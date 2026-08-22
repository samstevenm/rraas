-- RACK & ROLL '26 — D1 schema.
-- D1 (SQLite) is the claim path because KV cannot do atomic test-and-set:
-- the single UPDATE ... WHERE claimed_at IS NULL below is the whole reason
-- this table exists. Pages are immutable after claim by construction.

CREATE TABLE IF NOT EXISTS tokens (
  token       TEXT PRIMARY KEY,          -- 10-char Crockford base32, stored UPPER
  inviter     TEXT NOT NULL,             -- sam | connor | pearl
  codename    TEXT NOT NULL UNIQUE,      -- pre-assigned slug, server-owned
  claimed_at  TEXT,                      -- NULL = unclaimed; set exactly once
  display     TEXT,                      -- player-chosen, charset/length enforced
  bio         TEXT,                      -- plain text, <=280 chars, escaped at render
  company     TEXT,                      -- optional
  email       TEXT,                      -- optional; the business payload + their vCard
  has_photo   INTEGER NOT NULL DEFAULT 0,
  parent      TEXT,                       -- codename who roped them in (the chain)
  hidden      INTEGER NOT NULL DEFAULT 0,  -- kill switch (per page)
  busted      INTEGER NOT NULL DEFAULT 0,  -- the "definitely not curl" badge
  event       TEXT NOT NULL DEFAULT 'cedia-2026'  -- seasons, if The Game survives
);

CREATE TABLE IF NOT EXISTS rolls (
  codename  TEXT NOT NULL,
  day       TEXT NOT NULL,               -- YYYY-MM-DD UTC
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (codename, day)
);

-- global switches (photo kill switch etc.) — one row per flag
CREATE TABLE IF NOT EXISTS flags (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_parent ON tokens(parent);
