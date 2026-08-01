import type { AssistantEnv, DeviceRow } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

export async function sha256Url(value: string): Promise<string> {
  return (await sha256(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function scopedRecordId(deviceId: string, localId: string, kind = "record"): Promise<string> {
  return sha256(`${kind}\u0000${deviceId}\u0000${localId}`);
}

export async function withinActorRateLimit(env: AssistantEnv, scope: string, actor: string, limit: number, windowSeconds: number): Promise<boolean> {
  if (!env.DB) return true;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = await sha256(`${env.CRON_SECRET || "zapiski"}\u0000${scope}\u0000${actor}\u0000${bucket}`);
  const expiresAt = new Date((bucket + 2) * windowSeconds * 1000).toISOString();
  await env.DB.prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?1,1,?2) ON CONFLICT(key) DO UPDATE SET count=count+1").bind(key, expiresAt).run();
  const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE key=?1").bind(key).first<{ count: number }>();
  return Boolean(row && row.count <= limit);
}

export async function withinRateLimit(request: Request, env: AssistantEnv, scope: string, limit: number, windowSeconds: number): Promise<boolean> {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return withinActorRateLimit(env, scope, forwarded, limit, windowSeconds);
}

export function safeEqual(left: string | null, right: string | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function encryptionKey(env: AssistantEnv): Promise<CryptoKey> {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const bytes = base64ToBytes(env.TOKEN_ENCRYPTION_KEY);
  if (bytes.byteLength !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must contain exactly 32 bytes in base64");
  return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, env: AssistantEnv): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string, env: AssistantEnv): Promise<string> {
  const [ivValue, cipherValue] = value.split(".");
  if (!ivValue || !cipherValue) throw new Error("Encrypted secret is malformed");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) as BufferSource }, await encryptionKey(env), base64ToBytes(cipherValue) as BufferSource);
  return decoder.decode(decrypted);
}

export async function authenticate(request: Request, env: AssistantEnv): Promise<DeviceRow | null> {
  if (!env.DB) return null;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const tokenHash = await sha256(header.slice(7));
  const device = await env.DB.prepare("SELECT id, token_hash, name, timezone, telegram_chat_id FROM devices WHERE token_hash = ?1").bind(tokenHash).first<DeviceRow>();
  if (device) env.DB.prepare("UPDATE devices SET last_seen_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), device.id).run().catch(() => undefined);
  return device;
}
