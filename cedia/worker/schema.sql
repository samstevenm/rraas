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
  parent      TEXT,                       -- codename the CLAIMER says roped them in (the chain)
  hidden      INTEGER NOT NULL DEFAULT 0,  -- kill switch (per page)
  busted      INTEGER NOT NULL DEFAULT 0,  -- the "definitely not curl" badge
  event       TEXT NOT NULL DEFAULT 'cedia-2026',  -- seasons, if The Game survives
  -- provenance ledger: how this code came to exist and who spent it. We pretend
  -- not to watch out-of-band code trading; we watch all of it. minted_by is the
  -- player who generated this invite (NULL = an original crew-printed card); it
  -- is IMMUTABLE origin, while parent is whatever the claimer typed. When they
  -- disagree, the code changed hands — creative cheating, tracked for the reveal.
  minted_by   TEXT,                       -- codename that minted this invite (NULL = crew card)
  minted_at   TEXT,                       -- when it was minted
  mint_key    TEXT                        -- owner secret handed to the claimer, gates minting
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
CREATE INDEX IF NOT EXISTS idx_tokens_minted_by ON tokens(minted_by);
