CREATE TABLE IF NOT EXISTS google_connections (
  device_id TEXT PRIMARY KEY,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT NOT NULL,
  access_expires_at TEXT,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO google_connections(
  device_id,
  encrypted_access_token,
  encrypted_refresh_token,
  access_expires_at,
  calendar_id,
  connected_at,
  updated_at
)
SELECT
  device_id,
  encrypted_access_token,
  encrypted_refresh_token,
  access_expires_at,
  calendar_id,
  connected_at,
  updated_at
FROM google_connection;

ALTER TABLE calendar_items RENAME TO calendar_items_legacy;

CREATE TABLE calendar_items (
  local_id TEXT PRIMARY KEY,
  google_event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  date_key TEXT NOT NULL,
  time_key TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  fingerprint TEXT NOT NULL,
  google_updated_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
  client_local_id TEXT,
  UNIQUE(device_id, google_event_id)
);

INSERT INTO calendar_items(
  local_id, google_event_id, kind, title, date_key, time_key,
  duration_minutes, fingerprint, google_updated_at, status,
  created_at, updated_at, device_id, client_local_id
)
SELECT
  local_id, google_event_id, kind, title, date_key, time_key,
  duration_minutes, fingerprint, google_updated_at, status,
  created_at, updated_at,
  (SELECT device_id FROM google_connection LIMIT 1),
  local_id
FROM calendar_items_legacy;

DROP TABLE calendar_items_legacy;

ALTER TABLE reminders ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE CASCADE;
ALTER TABLE birthdays ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE CASCADE;
ALTER TABLE proposals ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE CASCADE;

UPDATE reminders
SET device_id = (
  SELECT devices.id FROM devices
  WHERE devices.telegram_chat_id = reminders.telegram_chat_id
  LIMIT 1
)
WHERE device_id IS NULL;

UPDATE birthdays
SET device_id = (
  SELECT devices.id FROM devices
  WHERE devices.telegram_chat_id = birthdays.telegram_chat_id
  LIMIT 1
)
WHERE device_id IS NULL;

UPDATE proposals
SET device_id = (
  SELECT devices.id FROM devices
  WHERE devices.telegram_chat_id = proposals.telegram_chat_id
  LIMIT 1
)
WHERE device_id IS NULL;

CREATE INDEX IF NOT EXISTS google_connections_device_idx ON google_connections(device_id);
CREATE INDEX IF NOT EXISTS calendar_items_date_idx ON calendar_items(date_key, time_key);
CREATE INDEX IF NOT EXISTS calendar_items_device_idx ON calendar_items(device_id, status);
CREATE INDEX IF NOT EXISTS reminders_device_idx ON reminders(device_id, status, due_at);
CREATE INDEX IF NOT EXISTS birthdays_device_idx ON birthdays(device_id, month, day);
CREATE INDEX IF NOT EXISTS proposals_device_idx ON proposals(device_id, expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits(expires_at);
