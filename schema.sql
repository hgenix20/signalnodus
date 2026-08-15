-- Signal Nodus billing.
--
-- Credits are stored as integer tenths-of-a-cent so no money value is ever a
-- float. 1000 units = $1.00.

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash    TEXT PRIMARY KEY,          -- sha256 of the key; the key itself is never stored
  label       TEXT NOT NULL DEFAULT '',
  credits     INTEGER NOT NULL DEFAULT 0, -- tenths of a cent
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  last_used   TEXT
);

CREATE TABLE IF NOT EXISTS usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject     TEXT NOT NULL,             -- key hash, or 'ip:<addr>' for free tier
  tool        TEXT NOT NULL,
  cost        INTEGER NOT NULL DEFAULT 0, -- tenths of a cent charged
  billable    INTEGER NOT NULL DEFAULT 0,
  day         TEXT NOT NULL,             -- YYYY-MM-DD, for free-tier windows
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_subject_day ON usage (subject, day);
CREATE INDEX IF NOT EXISTS usage_created ON usage (created_at);
