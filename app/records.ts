export type RecordType = "note" | "idea" | "task";
export type RecordStatus = "active" | "completed";

export interface Entry {
  id: string;
  type: RecordType;
  text: string;
  createdAt: string;
  updatedAt: string;
  status: RecordStatus;
  date?: string;
  time?: string;
  revisitDate?: string;
  reviewedAt?: string;
  completedAt?: string;
  sourcePlanId?: string;
  sourceTaskId?: string;
}

export const STORAGE_KEY = "zapiski.records.v1";
export const NOTIFIED_KEY = "zapiski.notified.v1";

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

export function ideaRevisitDate(createdAt = new Date()): string {
  return localDateKey(addDays(createdAt, 7));
}

export function readEntries(): Entry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeEntries(entries: Entry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function formatLongDate(date: Date): string {
  const text = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDateKey(value?: string): string {
  if (!value) return "Без даты";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(year, month - 1, day));
}

export function entryIsDue(entry: Entry, now = new Date()): boolean {
  const today = localDateKey(now);
  if (entry.status === "completed") return false;
  if (entry.type === "idea") return Boolean(!entry.reviewedAt && entry.revisitDate && entry.revisitDate <= today);
  if (entry.type !== "task" || !entry.date) return false;
  if (entry.date < today) return true;
  if (entry.date > today) return false;
  if (!entry.time) return true;
  const [hours, minutes] = entry.time.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
}

export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const aKey = `${a.date ?? a.revisitDate ?? "9999-99-99"} ${a.time ?? "23:59"}`;
    const bKey = `${b.date ?? b.revisitDate ?? "9999-99-99"} ${b.time ?? "23:59"}`;
    return aKey.localeCompare(bKey) || b.updatedAt.localeCompare(a.updatedAt);
  });
}
