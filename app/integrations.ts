import type { Birthday, ProposedPlan } from "./planning";
import type { Entry } from "./records";

const DEVICE_TOKEN_KEY = "zapiski.assistant.device-token.v1";
const PUBLIC_BACKEND = "https://zapiski-mobile-pwa.ev87st-2.chatgpt.site";
const publicBackendFallback = typeof window !== "undefined" && window.location.hostname.endsWith("github.io") ? PUBLIC_BACKEND : "";
const API_BASE = (import.meta.env.VITE_ASSISTANT_API_URL as string | undefined)?.replace(/\/$/, "") ?? publicBackendFallback;

export interface IntegrationStatus {
  backendReady: boolean;
  telegramConfigured: boolean;
  telegramConnected: boolean;
  googleConfigured: boolean;
  googleConnected: boolean;
  aiConfigured: boolean;
  botUsername?: string;
}

export function getDeviceToken(): string | null {
  return localStorage.getItem(DEVICE_TOKEN_KEY);
}

export function saveDeviceToken(token: string): void {
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
}

async function api<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (authenticated) {
    const token = getDeviceToken();
    if (!token) throw new Error("Сначала подключите Telegram");
    headers.set("authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(detail.error || "Сервис пока недоступен");
  }
  return response.json() as Promise<T>;
}

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  return api<IntegrationStatus>("/api/status", {}, Boolean(getDeviceToken()));
}

export async function startTelegramLink(timezone: string): Promise<{ challengeId: string; pollSecret: string; code: string; botUsername: string; expiresAt: string }> {
  return api("/api/link/start", { method: "POST", body: JSON.stringify({ timezone, deviceName: "Мой телефон" }) });
}

export async function pollTelegramLink(challengeId: string, pollSecret: string): Promise<{ linked: boolean; deviceToken?: string }> {
  return api(`/api/link/status?id=${encodeURIComponent(challengeId)}&secret=${encodeURIComponent(pollSecret)}`);
}

export async function getGoogleConnectUrl(): Promise<string> {
  const result = await api<{ url: string }>("/api/google/start", { method: "POST" }, true);
  return result.url;
}

export async function syncPlan(plan: ProposedPlan): Promise<{ synced: number }> {
  return api("/api/calendar/events", { method: "POST", body: JSON.stringify({ plan }) }, true);
}

export async function syncEntry(entry: Entry): Promise<{ synced: number }> {
  if (entry.type !== "task" || !entry.date) return { synced: 0 };
  return api("/api/calendar/events", { method: "POST", body: JSON.stringify({ plan: { weeks: [{ tasks: [{ id: entry.sourceTaskId ?? entry.id, text: entry.text, date: entry.date, time: entry.time, durationMinutes: 60 }] }] } }) }, true);
}

export async function deleteRemoteEntry(id: string): Promise<void> {
  await api(`/api/calendar/items/${encodeURIComponent(id)}`, { method: "DELETE" }, true);
}

export async function cancelRemoteReminder(id: string): Promise<void> {
  await api(`/api/reminders/${encodeURIComponent(id)}`, { method: "DELETE" }, true);
}

export async function syncBirthday(birthday: Birthday): Promise<{ synced: boolean }> {
  return api("/api/birthdays", { method: "POST", body: JSON.stringify({ birthday, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }, true);
}

export async function fetchCalendarChanges(): Promise<{ changes: Array<{ localId: string; text: string; date: string; time?: string; cancelled?: boolean }> }> {
  return api("/api/calendar/sync", { method: "POST" }, true);
}

export async function fetchTelegramProposal(id: string): Promise<{ plan: ProposedPlan; transcript?: string }> {
  return api(`/api/proposals/${encodeURIComponent(id)}`, {}, true);
}
