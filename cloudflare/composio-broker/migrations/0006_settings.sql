-- Keys the operator saved through the one-time setup page; a Worker secret of the same name wins over them.
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
