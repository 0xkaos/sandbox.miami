CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);