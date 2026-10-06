CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT REFERENCES users(id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX sessions_active_user ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  lat REAL NOT NULL CHECK (lat >= -90 AND lat <= 90),
  lon REAL NOT NULL CHECK (lon >= -180 AND lon <= 180),
  start_year INTEGER NOT NULL,
  end_year INTEGER NOT NULL CHECK (end_year >= start_year),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'public')),
  publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft', 'published', 'archived')),
  current_revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX notes_time_location ON notes(start_year, end_year, lat, lon);
CREATE INDEX notes_owner_updated ON notes(owner_id, updated_at DESC);
CREATE INDEX notes_public_time ON notes(publication_status, visibility, start_year, end_year);

CREATE TABLE note_access (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('view', 'edit')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, user_id)
);

CREATE TABLE note_revisions (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  body_key TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, revision)
);