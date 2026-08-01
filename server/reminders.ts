export function birthdayMessage(name: string, timing: "today" | "tomorrow"): string {
  return timing === "today" ? `Сегодня день рождения: ${name}` : `Завтра день рождения: ${name}`;
}

export function localParts(date: Date, timezone: string): { dateKey: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { dateKey: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

export function nextBirthdayDates(month: number, day: number, timezone: string, now = new Date()): { today: boolean; tomorrow: boolean } {
  const current = localParts(now, timezone).dateKey;
  const next = localParts(new Date(now.getTime() + 86_400_000), timezone).dateKey;
  const suffix = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { today: current.endsWith(suffix), tomorrow: next.endsWith(suffix) };
}

export function zonedDateTimeToUtc(dateKey: string, time: string, timezone: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parts = localParts(new Date(desiredUtc), timezone);
  const observedUtc = Date.parse(`${parts.dateKey}T${parts.time}:00Z`);
  return new Date(desiredUtc - (observedUtc - desiredUtc)).toISOString();
}
