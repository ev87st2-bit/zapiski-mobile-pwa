import { deriveProposal } from "./ai";
import { cancelManagedReminder, createBirthdayEvent, mappedCalendarChanges, removeManagedItem, upsertPlanEvents } from "./calendar";
import { birthdayMessage, nextBirthdayDates } from "./reminders";
import { authenticate, encryptSecret, randomToken, safeEqual, scopedRecordId, sha256, sha256Url, withinActorRateLimit, withinRateLimit } from "./security";
import { downloadTelegramVoice, sendTelegramMessage, telegramCall, transcribeVoice } from "./telegram";
import type { AssistantEnv, DeviceRow } from "./types";

function allowedOrigin(request: Request, env: AssistantEnv): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS || env.PUBLIC_APP_URL || "").split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function json(request: Request, env: AssistantEnv, value: unknown, status = 200): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  const origin = allowedOrigin(request, env); if (origin) { headers.set("access-control-allow-origin", origin); headers.set("vary", "origin"); }
  return new Response(JSON.stringify(value), { status, headers });
}

function redirect(url: string): Response { return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } }); }
function requireDb(env: AssistantEnv) { if (!env.DB) throw new Error("Backend database is not connected"); return env.DB; }
async function body<T>(request: Request): Promise<T> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 131_072) throw new Error("Request is too large");
  const text = await request.text();
  if (text.length > 131_072) throw new Error("Request is too large");
  return JSON.parse(text) as T;
}
function isValidTimezone(value: string): boolean { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; } }

async function status(request: Request, env: AssistantEnv): Promise<Response> {
  const device = await authenticate(request, env);
  let googleConnected = false;
  if (env.DB && device) googleConnected = Boolean(await env.DB.prepare("SELECT device_id FROM google_connections WHERE device_id = ?1").bind(device.id).first());
  return json(request, env, {
    backendReady: Boolean(env.DB), telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME),
    telegramConnected: Boolean(device?.telegram_chat_id), googleConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI),
    googleConnected, aiConfigured: Boolean(env.AI_API_KEY && env.AI_MODEL && env.TRANSCRIPTION_MODEL), botUsername: env.TELEGRAM_BOT_USERNAME,
  });
}

async function startLink(request: Request, env: AssistantEnv): Promise<Response> {
  const db = requireDb(env); if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME) return json(request, env, { error: "Telegram bot is not configured" }, 503);
  if (!await withinRateLimit(request, env, "link-start", 10, 600)) return json(request, env, { error: "Too many connection attempts. Try again later." }, 429);
  const payload = await body<{ timezone?: string; deviceName?: string }>(request);
  const timezone = payload.timezone && isValidTimezone(payload.timezone) ? payload.timezone : "UTC";
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const pollSecret = randomToken(); const id = crypto.randomUUID(); const now = new Date(); const expires = new Date(now.getTime() + 10 * 60_000).toISOString();
  await db.prepare("INSERT INTO link_challenges(id, code_hash, poll_hash, device_name, timezone, expires_at, created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)").bind(id, await sha256(code), await sha256(pollSecret), String(payload.deviceName || "Мой телефон").slice(0, 80), timezone, expires, now.toISOString()).run();
  return json(request, env, { challengeId: id, pollSecret, code, botUsername: env.TELEGRAM_BOT_USERNAME, expiresAt: expires }, 201);
}

async function pollLink(request: Request, env: AssistantEnv): Promise<Response> {
  const db = requireDb(env); const url = new URL(request.url); const id = url.searchParams.get("id") || ""; const secret = url.searchParams.get("secret") || "";
  const challenge = await db.prepare("SELECT id, poll_hash, device_name, timezone, telegram_chat_id, expires_at, used_at FROM link_challenges WHERE id = ?1").bind(id).first<{ id: string; poll_hash: string; device_name: string; timezone: string; telegram_chat_id: string | null; expires_at: string; used_at: string | null }>();
  if (!challenge || challenge.poll_hash !== await sha256(secret) || Date.parse(challenge.expires_at) < Date.now()) return json(request, env, { error: "Link code expired" }, 404);
  if (!challenge.telegram_chat_id) return json(request, env, { linked: false });
  if (challenge.used_at) return json(request, env, { linked: true });
  const deviceToken = randomToken(36); const now = new Date().toISOString();
  const existing = await db.prepare("SELECT id FROM devices WHERE telegram_chat_id=?1").bind(challenge.telegram_chat_id).first<{ id: string }>();
  const deviceId = existing?.id || crypto.randomUUID();
  const deviceWrite = existing
    ? db.prepare("UPDATE devices SET token_hash=?1,name=?2,timezone=?3,last_seen_at=?4 WHERE id=?5 AND telegram_chat_id=?6").bind(await sha256(deviceToken), challenge.device_name, challenge.timezone, now, deviceId, challenge.telegram_chat_id)
    : db.prepare("INSERT INTO devices(id, token_hash, name, timezone, telegram_chat_id, created_at, last_seen_at) VALUES(?1,?2,?3,?4,?5,?6,?6)").bind(deviceId, await sha256(deviceToken), challenge.device_name, challenge.timezone, challenge.telegram_chat_id, now);
  await db.batch([deviceWrite, db.prepare("UPDATE link_challenges SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL").bind(now, challenge.id)]);
  return json(request, env, { linked: true, deviceToken });
}

async function googleStart(request: Request, env: AssistantEnv): Promise<Response> {
  const db = requireDb(env); const device = await authenticate(request, env); if (!device) return json(request, env, { error: "Telegram connection is required" }, 401);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) return json(request, env, { error: "Google OAuth is not configured" }, 503);
  const state = randomToken(); const verifier = randomToken(48); const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare("INSERT INTO oauth_states(state_hash, device_id, code_verifier, expires_at, created_at) VALUES(?1,?2,?3,?4,?5)").bind(await sha256(state), device.id, verifier, expires, new Date().toISOString()).run();
  const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: "https://www.googleapis.com/auth/calendar.events.owned", state, code_challenge: await sha256Url(verifier), code_challenge_method: "S256" });
  return json(request, env, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
}

async function googleCallback(request: Request, env: AssistantEnv): Promise<Response> {
  const db = requireDb(env); const url = new URL(request.url); const state = url.searchParams.get("state") || ""; const code = url.searchParams.get("code") || "";
  const app = env.PUBLIC_APP_URL || "/"; if (!state || !code) return redirect(`${app}?google=error`);
  const stored = await db.prepare("SELECT state_hash, device_id, code_verifier, expires_at FROM oauth_states WHERE state_hash = ?1").bind(await sha256(state)).first<{ state_hash: string; device_id: string; code_verifier: string; expires_at: string }>();
  if (!stored || Date.parse(stored.expires_at) < Date.now() || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return redirect(`${app}?google=error`);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: "authorization_code", code_verifier: stored.code_verifier }) });
  const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tokenResponse.ok || !token.access_token) return redirect(`${app}?google=error`);
  const now = new Date().toISOString(); const expires = new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString();
  const existing = await db.prepare("SELECT encrypted_refresh_token FROM google_connections WHERE device_id=?1").bind(stored.device_id).first<{ encrypted_refresh_token: string }>();
  const encryptedRefreshToken = token.refresh_token ? await encryptSecret(token.refresh_token, env) : existing?.encrypted_refresh_token;
  if (!encryptedRefreshToken) return redirect(`${app}?google=error`);
  await db.batch([
    db.prepare("INSERT INTO google_connections(device_id,encrypted_access_token,encrypted_refresh_token,access_expires_at,calendar_id,connected_at,updated_at) VALUES(?1,?2,?3,?4,'primary',?5,?5) ON CONFLICT(device_id) DO UPDATE SET encrypted_access_token=excluded.encrypted_access_token,encrypted_refresh_token=excluded.encrypted_refresh_token,access_expires_at=excluded.access_expires_at,updated_at=excluded.updated_at").bind(stored.device_id, await encryptSecret(token.access_token, env), encryptedRefreshToken, expires, now),
    db.prepare("DELETE FROM oauth_states WHERE state_hash = ?1").bind(stored.state_hash),
  ]);
  return redirect(`${app}?google=connected`);
}

async function calendarEvents(request: Request, env: AssistantEnv): Promise<Response> {
  const device = await authenticate(request, env); if (!device) return json(request, env, { error: "Device is not connected" }, 401);
  const payload = await body<{ plan?: { weeks?: Array<{ tasks?: Array<{ id: string; text: string; date: string; time?: string; durationMinutes?: number }> }> } }>(request);
  const tasks = (payload.plan?.weeks || []).flatMap((week) => week.tasks || []).filter((task) => task.id && task.text && /^\d{4}-\d{2}-\d{2}$/.test(task.date));
  return json(request, env, { synced: await upsertPlanEvents(env, device, tasks) });
}

async function birthdays(request: Request, env: AssistantEnv): Promise<Response> {
  const db = requireDb(env); const device = await authenticate(request, env); if (!device?.telegram_chat_id) return json(request, env, { error: "Telegram connection is required" }, 401);
  const payload = await body<{ birthday?: { id: string; name: string; month: number; day: number; year?: number }; timezone?: string }>(request); const birthday = payload.birthday;
  if (!birthday?.id || !birthday.name || birthday.month < 1 || birthday.month > 12 || birthday.day < 1 || birthday.day > 31) return json(request, env, { error: "Birthday data is invalid" }, 400);
  const storageId = await scopedRecordId(device.id, birthday.id, "birthday");
  const existing = await db.prepare("SELECT google_event_id FROM birthdays WHERE id=?1 AND device_id=?2").bind(storageId, device.id).first<{ google_event_id: string | null }>();
  let googleEventId: string | null = null; try { googleEventId = await createBirthdayEvent(env, device, birthday, existing?.google_event_id); } catch { /* Calendar is optional. */ }
  const now = new Date().toISOString(); const timezone = payload.timezone && isValidTimezone(payload.timezone) ? payload.timezone : device.timezone;
  await db.prepare("INSERT INTO birthdays(id,name,month,day,birth_year,timezone,telegram_chat_id,google_event_id,created_at,updated_at,device_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10) ON CONFLICT(id) DO UPDATE SET name=excluded.name,month=excluded.month,day=excluded.day,birth_year=excluded.birth_year,timezone=excluded.timezone,telegram_chat_id=excluded.telegram_chat_id,google_event_id=COALESCE(excluded.google_event_id,birthdays.google_event_id),updated_at=excluded.updated_at WHERE birthdays.device_id=excluded.device_id").bind(storageId, birthday.name.slice(0, 120), birthday.month, birthday.day, birthday.year || null, timezone, device.telegram_chat_id, googleEventId, now, device.id).run();
  return json(request, env, { synced: true, calendar: Boolean(googleEventId) });
}

async function proposal(request: Request, env: AssistantEnv, id: string): Promise<Response> {
  const db = requireDb(env); const device = await authenticate(request, env); if (!device?.telegram_chat_id) return json(request, env, { error: "Device is not connected" }, 401);
  const row = await db.prepare("SELECT transcript, plan_json FROM proposals WHERE id = ?1 AND device_id = ?2 AND telegram_chat_id = ?3 AND expires_at > ?4").bind(id, device.id, device.telegram_chat_id, new Date().toISOString()).first<{ transcript: string | null; plan_json: string }>();
  if (!row) return json(request, env, { error: "Proposal not found" }, 404);
  return json(request, env, { transcript: row.transcript || undefined, plan: JSON.parse(row.plan_json) });
}

async function connectTelegramChat(env: AssistantEnv, chatId: string, code: string): Promise<boolean> {
  const db = requireDb(env); if (env.TELEGRAM_ALLOWED_CHAT_ID && env.TELEGRAM_ALLOWED_CHAT_ID !== chatId) return false;
  const codeHash = await sha256(code);
  const challenge = await db.prepare("SELECT id FROM link_challenges WHERE code_hash = ?1 AND expires_at > ?2 AND telegram_chat_id IS NULL").bind(codeHash, new Date().toISOString()).first<{ id: string }>();
  if (!challenge) return false;
  await db.prepare("UPDATE link_challenges SET telegram_chat_id = ?1 WHERE id = ?2").bind(chatId, challenge.id).run(); return true;
}

interface TelegramUpdate { message?: { chat?: { id?: number }; text?: string; voice?: { file_id?: string } } }

async function telegramWebhook(request: Request, env: AssistantEnv): Promise<Response> {
  if (!safeEqual(request.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_WEBHOOK_SECRET)) return new Response("Forbidden", { status: 403 });
  const update = await body<TelegramUpdate>(request); const chatId = update.message?.chat?.id ? String(update.message.chat.id) : ""; if (!chatId) return new Response("OK");
  const text = update.message?.text?.trim() || "";
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1] || ""; const linked = await connectTelegramChat(env, chatId, code);
    await sendTelegramMessage(env, chatId, linked ? "Готово. Этот чат подключён к приложению «Записки». Здесь будут приходить напоминания." : "Код подключения не найден или уже истёк. Получите новый код в приложении.");
    return new Response("OK");
  }
  const db = requireDb(env); const device = await db.prepare("SELECT id, token_hash, name, timezone, telegram_chat_id FROM devices WHERE telegram_chat_id = ?1").bind(chatId).first<DeviceRow>();
  if (!device) { await sendTelegramMessage(env, chatId, "Сначала подключите этот чат в приложении «Записки»."); return new Response("OK"); }
  const voiceId = update.message?.voice?.file_id;
  if (voiceId) {
    if (!await withinActorRateLimit(env, "telegram-voice", chatId, 20, 86_400)) {
      await sendTelegramMessage(env, chatId, "Сегодня обработано слишком много голосовых сообщений. Попробуйте снова завтра.");
      return new Response("OK");
    }
    try {
      await sendTelegramMessage(env, chatId, "Слушаю и превращаю голос в предложение…");
      const transcript = await transcribeVoice(env, await downloadTelegramVoice(env, voiceId));
      const plan = await deriveProposal(transcript, device.timezone, env); const id = crypto.randomUUID(); const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await db.prepare("INSERT INTO proposals(id,source,transcript,plan_json,telegram_chat_id,status,expires_at,created_at,device_id) VALUES(?1,'telegram_voice',?2,?3,?4,'draft',?5,?6,?7)").bind(id, transcript, JSON.stringify(plan), chatId, expires, new Date().toISOString(), device.id).run();
      const url = `${(env.PUBLIC_APP_URL || "").replace(/\/$/, "")}/?proposal=${encodeURIComponent(id)}`;
      await sendTelegramMessage(env, chatId, `Распознано: ${transcript}\n\nЯ подготовила предложение. Проверьте даты и подтвердите его в приложении: ${url}`);
    } catch (error) { await sendTelegramMessage(env, chatId, `Не удалось обработать голос: ${error instanceof Error ? error.message : "неизвестная ошибка"}. Аудио не сохранено.`); }
    return new Response("OK");
  }
  await sendTelegramMessage(env, chatId, "Пришлите голосовое сообщение с задачей или встречей. Я расшифрую его и предложу план для подтверждения.");
  return new Response("OK");
}

export async function processScheduledReminders(env: AssistantEnv, now = new Date()): Promise<{ sent: number; failed: number }> {
  const db = requireDb(env); let sent = 0; let failed = 0; const nowIso = now.toISOString();
  const due = (await db.prepare("SELECT id, title, telegram_chat_id FROM reminders WHERE status = 'pending' AND due_at <= ?1 ORDER BY due_at LIMIT 100").bind(nowIso).all<{ id: string; title: string; telegram_chat_id: string }>()).results;
  for (const item of due) {
    try { await sendTelegramMessage(env, item.telegram_chat_id, item.title); await db.prepare("UPDATE reminders SET status='sent', sent_at=?1, last_error=NULL WHERE id=?2").bind(nowIso, item.id).run(); sent += 1; }
    catch (error) { await db.prepare("UPDATE reminders SET last_error=?1 WHERE id=?2").bind(String(error).slice(0, 500), item.id).run(); failed += 1; }
  }
  const birthdayRows = (await db.prepare("SELECT id,name,month,day,timezone,telegram_chat_id,device_id FROM birthdays WHERE device_id IS NOT NULL").all<{ id: string; name: string; month: number; day: number; timezone: string; telegram_chat_id: string; device_id: string }>()).results;
  for (const birthday of birthdayRows) {
    const timing = nextBirthdayDates(birthday.month, birthday.day, birthday.timezone, now); const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: birthday.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    for (const kind of [timing.today ? "today" : null, timing.tomorrow ? "tomorrow" : null] as const) {
      if (!kind) continue;
      const marker = `${birthday.id}:${localDate}:${kind}`; const existing = await db.prepare("SELECT id FROM reminders WHERE local_id=?1 AND kind=?2").bind(marker, `birthday_${kind}`).first(); if (existing) continue;
      try { await sendTelegramMessage(env, birthday.telegram_chat_id, birthdayMessage(birthday.name, kind)); await db.prepare("INSERT INTO reminders(id,local_id,kind,title,due_at,timezone,telegram_chat_id,status,sent_at,created_at,device_id) VALUES(?1,?2,?3,?4,?5,?6,?7,'sent',?5,?5,?8)").bind(crypto.randomUUID(), marker, `birthday_${kind}`, birthdayMessage(birthday.name, kind), nowIso, birthday.timezone, birthday.telegram_chat_id, birthday.device_id).run(); sent += 1; }
      catch { failed += 1; }
    }
  }
  await db.batch([db.prepare("DELETE FROM link_challenges WHERE expires_at < ?1").bind(nowIso), db.prepare("DELETE FROM oauth_states WHERE expires_at < ?1").bind(nowIso), db.prepare("DELETE FROM proposals WHERE expires_at < ?1").bind(nowIso), db.prepare("DELETE FROM rate_limits WHERE expires_at < ?1").bind(nowIso)]);
  return { sent, failed };
}

async function setupTelegram(request: Request, env: AssistantEnv): Promise<Response> {
  if (!safeEqual(request.headers.get("authorization")?.replace(/^Bearer\s+/, "") || null, env.CRON_SECRET)) return json(request, env, { error: "Forbidden" }, 403);
  if (!env.PUBLIC_APP_URL || !env.TELEGRAM_WEBHOOK_SECRET) return json(request, env, { error: "Public URL or webhook secret is missing" }, 503);
  await telegramCall(env, "setWebhook", { url: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/api/telegram/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: true });
  await telegramCall(env, "setMyCommands", { commands: [{ command: "start", description: "Подключить приложение" }, { command: "help", description: "Как пользоваться помощником" }] });
  return json(request, env, { configured: true });
}

export async function handleApiRequest(request: Request, env: AssistantEnv): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname;
  if (request.method === "OPTIONS") { const origin = allowedOrigin(request, env); return new Response(null, { status: origin ? 204 : 403, headers: origin ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "authorization,content-type", vary: "origin" } : {} }); }
  try {
    if (path === "/api/status" && request.method === "GET") return status(request, env);
    if (path === "/api/link/start" && request.method === "POST") return startLink(request, env);
    if (path === "/api/link/status" && request.method === "GET") return pollLink(request, env);
    if (path === "/api/google/start" && request.method === "POST") return googleStart(request, env);
    if (path === "/api/google/callback" && request.method === "GET") return googleCallback(request, env);
    if (path === "/api/calendar/events" && request.method === "POST") return calendarEvents(request, env);
    if (path.startsWith("/api/calendar/items/") && request.method === "DELETE") { const device = await authenticate(request, env); if (!device) return json(request, env, { error: "Device is not connected" }, 401); await removeManagedItem(env, device, decodeURIComponent(path.slice("/api/calendar/items/".length))); return json(request, env, { removed: true }); }
    if (path.startsWith("/api/reminders/") && request.method === "DELETE") { const device = await authenticate(request, env); if (!device) return json(request, env, { error: "Device is not connected" }, 401); await cancelManagedReminder(env, device, decodeURIComponent(path.slice("/api/reminders/".length))); return json(request, env, { cancelled: true }); }
    if (path === "/api/calendar/sync" && request.method === "POST") { const device = await authenticate(request, env); return device ? json(request, env, { changes: await mappedCalendarChanges(env, device) }) : json(request, env, { error: "Device is not connected" }, 401); }
    if (path === "/api/birthdays" && request.method === "POST") return birthdays(request, env);
    if (path.startsWith("/api/proposals/") && request.method === "GET") return proposal(request, env, decodeURIComponent(path.slice("/api/proposals/".length)));
    if (path === "/api/telegram/webhook" && request.method === "POST") return telegramWebhook(request, env);
    if (path === "/api/admin/telegram/setup" && request.method === "POST") return setupTelegram(request, env);
    if (path === "/api/cron" && request.method === "POST") { if (!safeEqual(request.headers.get("authorization")?.replace(/^Bearer\s+/, "") || null, env.CRON_SECRET)) return json(request, env, { error: "Forbidden" }, 403); return json(request, env, await processScheduledReminders(env)); }
    return json(request, env, { error: "Not found" }, 404);
  } catch (error) { return json(request, env, { error: error instanceof Error ? error.message : "Unexpected backend error" }, 500); }
}
