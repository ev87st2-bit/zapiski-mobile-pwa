import type { AssistantEnv } from "./types";

interface TelegramResponse<T> { ok: boolean; result?: T; description?: string }

export async function telegramCall<T>(env: AssistantEnv, method: string, body: Record<string, unknown>): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram bot is not configured");
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json() as TelegramResponse<T>;
  if (!response.ok || !payload.ok || payload.result === undefined) throw new Error(payload.description || `Telegram ${method} failed`);
  return payload.result;
}

export function sendTelegramMessage(env: AssistantEnv, chatId: string, text: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  return telegramCall(env, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra });
}

export async function downloadTelegramVoice(env: AssistantEnv, fileId: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const file = await telegramCall<{ file_path?: string }>(env, "getFile", { file_id: fileId });
  if (!file.file_path || !env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram voice file is unavailable");
  const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!response.ok) throw new Error("Telegram voice download failed");
  return { bytes: await response.arrayBuffer(), mimeType: response.headers.get("content-type") || "audio/ogg" };
}

export async function transcribeVoice(env: AssistantEnv, voice: { bytes: ArrayBuffer; mimeType: string }): Promise<string> {
  if (!env.AI_API_KEY || !env.TRANSCRIPTION_MODEL) throw new Error("Voice transcription provider is not configured");
  const endpoint = `${(env.AI_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "")}/audio/transcriptions`;
  const form = new FormData();
  form.set("model", env.TRANSCRIPTION_MODEL);
  form.set("language", "ru");
  form.set("file", new Blob([voice.bytes], { type: voice.mimeType }), "voice.ogg");
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${env.AI_API_KEY}` }, body: form });
  const payload = await response.json() as { text?: string; error?: { message?: string } };
  if (!response.ok || !payload.text) throw new Error(payload.error?.message || "Voice transcription failed");
  return payload.text.trim();
}
