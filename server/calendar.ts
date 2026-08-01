import { decryptSecret, encryptSecret, scopedRecordId, sha256 } from "./security";
import { zonedDateTimeToUtc } from "./reminders";
import type { AssistantEnv, DeviceRow, GoogleConnectionRow } from "./types";

interface PlannedTaskInput { id: string; text: string; date: string; time?: string; durationMinutes?: number }

async function connection(env: AssistantEnv, deviceId: string): Promise<GoogleConnectionRow> {
  if (!env.DB) throw new Error("Database is unavailable");
  const row = await env.DB.prepare("SELECT encrypted_access_token, encrypted_refresh_token, access_expires_at, calendar_id FROM google_connections WHERE device_id = ?1").bind(deviceId).first<GoogleConnectionRow>();
  if (!row) throw new Error("Google Calendar is not connected");
  return row;
}

export async function googleAccessToken(env: AssistantEnv, deviceId: string): Promise<string> {
  const row = await connection(env, deviceId);
  if (row.encrypted_access_token && row.access_expires_at && Date.parse(row.access_expires_at) > Date.now() + 60_000) return decryptSecret(row.encrypted_access_token, env);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error("Google OAuth is not configured");
  const refreshToken = await decryptSecret(row.encrypted_refresh_token, env);
  const body = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || "Google token refresh failed");
  const expiresAt = new Date(Date.now() + (payload.expires_in || 3600) * 1000).toISOString();
  await env.DB?.prepare("UPDATE google_connections SET encrypted_access_token = ?1, access_expires_at = ?2, updated_at = ?3 WHERE device_id = ?4").bind(await encryptSecret(payload.access_token, env), expiresAt, new Date().toISOString(), deviceId).run();
  return payload.access_token;
}

async function googleRequest<T>(env: AssistantEnv, deviceId: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers); headers.set("authorization", `Bearer ${await googleAccessToken(env, deviceId)}`); headers.set("content-type", "application/json");
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...init, headers });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "Google Calendar request failed");
  return payload;
}

function eventBody(task: PlannedTaskInput, timezone: string) {
  const duration = Math.max(15, Math.min(240, task.durationMinutes || 60));
  if (!task.time) return { summary: task.text, start: { date: task.date }, end: { date: new Date(Date.parse(`${task.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) }, extendedProperties: { private: { zapiskiOwner: "planning-assistant", zapiskiId: task.id } } };
  const start = zonedDateTimeToUtc(task.date, task.time, timezone);
  const end = new Date(Date.parse(start) + duration * 60_000).toISOString();
  return { summary: task.text, start: { dateTime: start, timeZone: timezone }, end: { dateTime: end, timeZone: timezone }, extendedProperties: { private: { zapiskiOwner: "planning-assistant", zapiskiId: task.id } } };
}

export async function upsertPlanEvents(env: AssistantEnv, device: DeviceRow, tasks: PlannedTaskInput[]): Promise<number> {
  if (!env.DB || !device.telegram_chat_id) throw new Error("Telegram must be connected first");
  let google: GoogleConnectionRow | null = null;
  try { google = await connection(env, device.id); } catch { /* Telegram reminders work without Google. */ }
  let synced = 0;
  for (const task of tasks.slice(0, 80)) {
    const now = new Date().toISOString();
    const scopedId = await scopedRecordId(device.id, task.id, "calendar-item");
    if (google) {
      const payload = eventBody(task, device.timezone);
      const fingerprint = await sha256(JSON.stringify(payload));
      const mapped = await env.DB.prepare("SELECT google_event_id, fingerprint FROM calendar_items WHERE local_id = ?1 AND device_id = ?2").bind(scopedId, device.id).first<{ google_event_id: string; fingerprint: string }>();
      if (!mapped || mapped.fingerprint !== fingerprint) {
        const event = mapped
          ? await googleRequest<{ id: string; updated?: string }>(env, device.id, `/calendars/${encodeURIComponent(google.calendar_id)}/events/${encodeURIComponent(mapped.google_event_id)}`, { method: "PATCH", body: JSON.stringify(payload) })
          : await googleRequest<{ id: string; updated?: string }>(env, device.id, `/calendars/${encodeURIComponent(google.calendar_id)}/events`, { method: "POST", body: JSON.stringify(payload) });
        await env.DB.prepare("INSERT INTO calendar_items(local_id, google_event_id, kind, title, date_key, time_key, duration_minutes, fingerprint, google_updated_at, status, created_at, updated_at, device_id, client_local_id) VALUES(?1,?2,'task',?3,?4,?5,?6,?7,?8,'active',?9,?9,?10,?11) ON CONFLICT(local_id) DO UPDATE SET google_event_id=excluded.google_event_id,title=excluded.title,date_key=excluded.date_key,time_key=excluded.time_key,duration_minutes=excluded.duration_minutes,fingerprint=excluded.fingerprint,google_updated_at=excluded.google_updated_at,status='active',updated_at=excluded.updated_at,client_local_id=excluded.client_local_id WHERE calendar_items.device_id=excluded.device_id").bind(scopedId, event.id, task.text, task.date, task.time || null, task.durationMinutes || 60, fingerprint, event.updated || now, now, device.id, task.id).run();
      }
      synced += 1;
    }
    if (task.time) {
      const dueAt = zonedDateTimeToUtc(task.date, task.time, device.timezone);
      await env.DB.batch([
        env.DB.prepare("UPDATE reminders SET status='cancelled' WHERE local_id=?1 AND device_id=?2 AND kind='scheduled' AND status='pending'").bind(scopedId, device.id),
        env.DB.prepare("INSERT OR IGNORE INTO reminders(id, local_id, kind, title, due_at, timezone, telegram_chat_id, status, created_at, device_id) VALUES(?1,?2,'scheduled',?3,?4,?5,?6,'pending',?7,?8)").bind(crypto.randomUUID(), scopedId, `Напоминание: ${task.text}`, dueAt, device.timezone, device.telegram_chat_id, now, device.id),
      ]);
    }
  }
  return synced;
}

export async function removeManagedItem(env: AssistantEnv, device: DeviceRow, localId: string): Promise<void> {
  if (!env.DB) throw new Error("Database is unavailable");
  const scopedId = await scopedRecordId(device.id, localId, "calendar-item");
  const mapping = await env.DB.prepare("SELECT google_event_id FROM calendar_items WHERE local_id=?1 AND device_id=?2 AND status='active'").bind(scopedId, device.id).first<{ google_event_id: string }>();
  if (mapping) {
    try {
      const google = await connection(env, device.id); const token = await googleAccessToken(env, device.id);
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(google.calendar_id)}/events/${encodeURIComponent(mapping.google_event_id)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    } catch { /* The local explicit deletion still cancels reminders. */ }
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE calendar_items SET status='deleted', updated_at=?1 WHERE local_id=?2 AND device_id=?3").bind(new Date().toISOString(), scopedId, device.id),
    env.DB.prepare("UPDATE reminders SET status='cancelled' WHERE local_id=?1 AND device_id=?2 AND status='pending'").bind(scopedId, device.id),
  ]);
}

export async function cancelManagedReminder(env: AssistantEnv, device: DeviceRow, localId: string): Promise<void> {
  if (!env.DB) throw new Error("Database is unavailable");
  const scopedId = await scopedRecordId(device.id, localId, "calendar-item");
  await env.DB.prepare("UPDATE reminders SET status='cancelled' WHERE local_id=?1 AND device_id=?2 AND status='pending'").bind(scopedId, device.id).run();
}

export async function createBirthdayEvent(env: AssistantEnv, device: DeviceRow, birthday: { id: string; name: string; month: number; day: number; year?: number }, existingEventId?: string | null): Promise<string | null> {
  const google = await connection(env, device.id); const year = birthday.year || new Date().getFullYear();
  const start = `${year}-${String(birthday.month).padStart(2, "0")}-${String(birthday.day).padStart(2, "0")}`;
  const next = new Date(`${start}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const eventPath = `/calendars/${encodeURIComponent(google.calendar_id)}/events${existingEventId ? `/${encodeURIComponent(existingEventId)}` : ""}`;
  const event = await googleRequest<{ id: string }>(env, device.id, eventPath, { method: existingEventId ? "PATCH" : "POST", body: JSON.stringify({ summary: `День рождения: ${birthday.name}`, start: { date: start }, end: { date: next.toISOString().slice(0, 10) }, recurrence: ["RRULE:FREQ=YEARLY"], transparency: "transparent", extendedProperties: { private: { zapiskiOwner: "planning-assistant", zapiskiId: birthday.id, zapiskiKind: "birthday" } } }) });
  return event.id;
}

export async function mappedCalendarChanges(env: AssistantEnv, device: DeviceRow): Promise<Array<{ localId: string; text: string; date: string; time?: string; cancelled?: boolean }>> {
  if (!env.DB) throw new Error("Database is unavailable");
  const google = await connection(env, device.id);
  const mappings = (await env.DB.prepare("SELECT client_local_id, google_event_id, title, date_key, time_key FROM calendar_items WHERE device_id=?1 AND status='active'").bind(device.id).all<{ client_local_id: string; google_event_id: string; title: string; date_key: string; time_key: string | null }>()).results;
  const changes: Array<{ localId: string; text: string; date: string; time?: string; cancelled?: boolean }> = [];
  for (const mapping of mappings) {
    try {
      const event = await googleRequest<{ status?: string; summary?: string; start?: { date?: string; dateTime?: string } }>(env, device.id, `/calendars/${encodeURIComponent(google.calendar_id)}/events/${encodeURIComponent(mapping.google_event_id)}`);
      if (event.status === "cancelled") { changes.push({ localId: mapping.client_local_id, text: "Отменено в Google Calendar", date: new Date().toISOString().slice(0, 10), cancelled: true }); continue; }
      const date = event.start?.date || event.start?.dateTime?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const time = event.start?.dateTime?.slice(11, 16);
      if ((event.summary || "Событие") !== mapping.title || date !== mapping.date_key || (time || null) !== mapping.time_key) changes.push({ localId: mapping.client_local_id, text: event.summary || "Событие", date, time });
    } catch { /* One unavailable event must not block the rest. */ }
  }
  return changes;
}
