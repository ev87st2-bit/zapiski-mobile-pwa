import type { Entry } from "./records";

export type GoalArea = "personal" | "work";
export type PlanStatus = "draft" | "accepted";

export interface Goal {
  id: string;
  title: string;
  area: GoalArea;
  details: string;
  targetDate?: string;
  weeklyHours: number;
  createdAt: string;
  status: "active" | "completed";
}

export interface PlannedTask {
  id: string;
  text: string;
  date: string;
  time: string;
  durationMinutes: number;
}

export interface PlanWeek {
  index: number;
  startsOn: string;
  title: string;
  objective: string;
  tasks: PlannedTask[];
}

export interface ProposedPlan {
  id: string;
  goalId: string;
  goalTitle: string;
  createdAt: string;
  status: PlanStatus;
  weeks: PlanWeek[];
}

export interface Birthday {
  id: string;
  name: string;
  month: number;
  day: number;
  year?: number;
  createdAt: string;
}

export const GOALS_KEY = "zapiski.goals.v1";
export const PLANS_KEY = "zapiski.plans.v1";
export const BIRTHDAYS_KEY = "zapiski.birthdays.v1";

function readArray<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export const readGoals = () => readArray<Goal>(GOALS_KEY);
export const readPlans = () => readArray<ProposedPlan>(PLANS_KEY);
export const readBirthdays = () => readArray<Birthday>(BIRTHDAYS_KEY);
export const writeGoals = (items: Goal[]) => localStorage.setItem(GOALS_KEY, JSON.stringify(items));
export const writePlans = (items: ProposedPlan[]) => localStorage.setItem(PLANS_KEY, JSON.stringify(items));
export const writeBirthdays = (items: Birthday[]) => localStorage.setItem(BIRTHDAYS_KEY, JSON.stringify(items));

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  const day = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - day);
  return result;
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function weekCount(targetDate: string | undefined, now: Date): number {
  if (!targetDate) return 4;
  const target = new Date(`${targetDate}T12:00:00`);
  const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
  return Math.max(2, Math.min(8, Math.ceil(days / 7)));
}

function phaseFor(index: number, total: number): { title: string; objective: string } {
  if (index === 0) return { title: "Неделя 1 · Подготовка", objective: "Уточнить результат и сделать первый небольшой шаг" };
  if (index === total - 1) return { title: `Неделя ${index + 1} · Завершение`, objective: "Собрать результат, проверить и закрыть оставшееся" };
  if (index >= Math.ceil(total * 0.65)) return { title: `Неделя ${index + 1} · Проверка`, objective: "Проверить прогресс и скорректировать следующий шаг" };
  return { title: `Неделя ${index + 1} · Основная работа`, objective: "Продвинуть цель через конкретные выполнимые действия" };
}

function taskTexts(goal: Goal, weekIndex: number, total: number): string[] {
  if (weekIndex === 0) {
    return [
      `Определить готовый результат: ${goal.title}`,
      `Подготовить всё необходимое для цели «${goal.title}»`,
      `Сделать первый практический шаг по цели «${goal.title}»`,
    ];
  }
  if (weekIndex === total - 1) {
    return [
      `Завершить основную часть цели «${goal.title}»`,
      `Проверить результат и исправить недочёты`,
      `Подвести итог и определить следующий шаг`,
    ];
  }
  return [
    `Основной шаг ${weekIndex}: ${goal.title}`,
    `Продолжить работу и зафиксировать прогресс`,
    `Коротко проверить план на следующую неделю`,
  ];
}

export function proposeGoalPlan(goal: Goal, entries: Entry[], now = new Date()): ProposedPlan {
  const total = weekCount(goal.targetDate, now);
  const firstWeek = startOfWeek(now);
  const offsets = goal.area === "work" ? [1, 3, 4] : [1, 3, 5];
  const baseTimes = goal.area === "work" ? ["10:00", "15:00", "11:00"] : ["18:30", "18:30", "11:00"];
  const occupied = new Set(entries.filter((item) => item.type === "task" && item.date).map((item) => `${item.date} ${item.time ?? ""}`));
  const duration = Math.max(30, Math.min(120, Math.round((goal.weeklyHours * 60) / 3 / 15) * 15));

  const weeks = Array.from({ length: total }, (_, weekIndex) => {
    const weekStart = addDays(firstWeek, weekIndex * 7);
    const phase = phaseFor(weekIndex, total);
    const texts = taskTexts(goal, weekIndex, total);
    const tasks = texts.map((text, taskIndex) => {
      const candidate = addDays(weekStart, offsets[taskIndex]);
      if (candidate < now) candidate.setDate(candidate.getDate() + 7);
      const date = toDateKey(candidate);
      let time = baseTimes[taskIndex];
      while (occupied.has(`${date} ${time}`)) {
        const [hours, minutes] = time.split(":").map(Number);
        const next = hours * 60 + minutes + 30;
        time = `${String(Math.min(21, Math.floor(next / 60))).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
      }
      occupied.add(`${date} ${time}`);
      return { id: crypto.randomUUID(), text, date, time, durationMinutes: duration };
    });
    return { index: weekIndex + 1, startsOn: toDateKey(weekStart), ...phase, tasks };
  });

  return {
    id: crypto.randomUUID(), goalId: goal.id, goalTitle: goal.title,
    createdAt: new Date().toISOString(), status: "draft", weeks,
  };
}

export function birthdayDateForYear(birthday: Birthday, year: number): string {
  return `${year}-${String(birthday.month).padStart(2, "0")}-${String(birthday.day).padStart(2, "0")}`;
}

export function birthdaysForDate(birthdays: Birthday[], dateKey: string): Birthday[] {
  const [, month, day] = dateKey.split("-").map(Number);
  return birthdays.filter((birthday) => birthday.month === month && birthday.day === day);
}

export function birthdayReminderState(birthday: Birthday, now = new Date()): "today" | "tomorrow" | null {
  const todayKey = toDateKey(now);
  const tomorrowKey = toDateKey(addDays(now, 1));
  const thisYear = now.getFullYear();
  if (birthdayDateForYear(birthday, thisYear) === todayKey) return "today";
  const tomorrowYear = new Date(`${tomorrowKey}T12:00:00`).getFullYear();
  if (birthdayDateForYear(birthday, tomorrowYear) === tomorrowKey) return "tomorrow";
  return null;
}

export function planTasksToEntries(plan: ProposedPlan): Entry[] {
  const now = new Date().toISOString();
  return plan.weeks.flatMap((week) => week.tasks.map((task) => ({
    id: crypto.randomUUID(), type: "task" as const, text: task.text,
    date: task.date, time: task.time, createdAt: now, updatedAt: now,
    status: "active" as const, sourcePlanId: plan.id, sourceTaskId: task.id,
  })));
}
