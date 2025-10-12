CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS memberships(
  user_id TEXT NOT NULL PRIMARY KEY,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'none',
  current_period_end INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS tickets_index(
  ticket_id TEXT PRIMARY KEY,
  user_id TEXT,
  event_id TEXT,
  created_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
