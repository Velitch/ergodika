-- Users + auth
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_alg TEXT,
  password_iter INTEGER,
  password_salt TEXT,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  roles TEXT DEFAULT '["user"]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  jti TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- Artist ownership
CREATE TABLE IF NOT EXISTS user_owns (
  user_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  PRIMARY KEY (user_id, artist_id)
);

-- Artists
CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  links_json TEXT DEFAULT '{}',
  stripe_account_id TEXT,
  deleted_at TEXT
);

-- Tracks catalog
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT,
  genre TEXT,
  mood TEXT,
  bpm INTEGER,
  year INTEGER,
  duration_sec INTEGER,
  is_premium INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
  title, artist, genre, mood, content='',
  tokenize='porter'
);

CREATE TABLE IF NOT EXISTS track_assets (
  track_id TEXT PRIMARY KEY,
  preview_url TEXT,
  full_url TEXT,
  cover_url TEXT
);

-- Plays/events for revenue share
CREATE TABLE IF NOT EXISTS plays (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  track_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  milestone TEXT NOT NULL, -- start|30s|50pct|90pct|complete
  seconds INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Access rights (unlock / subscription)
CREATE TABLE IF NOT EXISTS access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  track_id TEXT,
  kind TEXT NOT NULL, -- 'unlock'|'sub'
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Wallet (optional)
CREATE TABLE IF NOT EXISTS wallet (
  user_id TEXT PRIMARY KEY,
  balance_cents INTEGER DEFAULT 0
);

-- Ledger for payouts
CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  artist_id TEXT,
  track_id TEXT,
  type TEXT, -- donation|sale|sub_artist|sub_pool|royalty|tip|unlock
  gross_cents INTEGER,
  fee_platform_cents INTEGER,
  fee_stripe_cents INTEGER,
  net_to_artist_cents INTEGER,
  currency TEXT DEFAULT 'eur',
  source TEXT, -- stripe|distributor
  created_at INTEGER NOT NULL
);
