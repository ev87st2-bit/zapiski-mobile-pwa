export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}

interface FetcherLike { fetch(request: Request): Promise<Response>; }

export interface AssistantEnv {
  ASSETS: FetcherLike;
  IMAGES: { input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } } };
  DB?: D1DatabaseLike;
  PUBLIC_APP_URL?: string;
  GOOGLE_REDIRECT_URI?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ALLOWED_CHAT_ID?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  AI_API_BASE?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  TRANSCRIPTION_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  CRON_SECRET?: string;
}

export interface DeviceRow {
  id: string;
  token_hash: string;
  name: string;
  timezone: string;
  telegram_chat_id: string | null;
}

export interface GoogleConnectionRow {
  encrypted_access_token: string | null;
  encrypted_refresh_token: string;
  access_expires_at: string | null;
  calendar_id: string;
}
