/**
 * Каноническое описание схемы D1. Рабочая миграция находится в
 * drizzle/*.sql и применяются платформой при публикации.
 */
export const TABLES = [
  "devices", "link_challenges", "oauth_states", "google_connections",
  "calendar_items", "reminders", "birthdays", "proposals", "rate_limits",
] as const;

export type TableName = typeof TABLES[number];
