CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  telegram_chat_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS link_challenges (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  poll_hash TEXT NOT NULL,
  device_name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  telegram_chat_id TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS link_challenges_expires_idx ON link_challenges(expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS google_connection (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  device_id TEXT NOT NULL,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT NOT NULL,
  access_expires_at TEXT,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_items (
  local_id TEXT PRIMARY KEY,
  google_event_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  date_key TEXT NOT NULL,
  time_key TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  fingerprint TEXT NOT NULL,
  google_updated_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS calendar_items_date_idx ON calendar_items(date_key, time_key);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  local_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(local_id, kind, due_at)
);

CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders(status, due_at);

CREATE TABLE IF NOT EXISTS birthdays (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  month INTEGER NOT NULL,
  day INTEGER NOT NULL,
  birth_year INTEGER,
  timezone TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  google_event_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS birthdays_month_day_idx ON birthdays(month, day);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  transcript TEXT,
  plan_json TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS proposals_expires_idx ON proposals(expires_at);
