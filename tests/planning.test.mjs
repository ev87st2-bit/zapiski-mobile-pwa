import test from "node:test";
import assert from "node:assert/strict";
import { birthdayReminderState, birthdaysForDate, proposeGoalPlan } from "../app/planning.ts";
import { birthdayMessage, nextBirthdayDates, zonedDateTimeToUtc } from "../server/reminders.ts";

test("goal plan is split into editable weekly tasks without occupied slots", () => {
  const now = new Date(2026, 7, 3, 9, 0);
  const goal = { id: "g1", title: "Подготовить праздник", area: "personal", details: "", weeklyHours: 3, targetDate: "2026-08-31", createdAt: now.toISOString(), status: "active" };
  const plan = proposeGoalPlan(goal, [{ id: "busy", type: "task", text: "Занято", date: "2026-08-04", time: "18:30", createdAt: now.toISOString(), updatedAt: now.toISOString(), status: "active" }], now);
  assert.equal(plan.status, "draft");
  assert.equal(plan.weeks.length, 5);
  assert.equal(plan.weeks.every((week) => week.tasks.length === 3), true);
  assert.notEqual(plan.weeks[0].tasks[0].time, "18:30");
});

test("birthdays recur yearly and surface today or tomorrow", () => {
  const birthday = { id: "b1", name: "Сергей", month: 8, day: 2, createdAt: "2026-01-01T00:00:00Z" };
  assert.equal(birthdayReminderState(birthday, new Date(2026, 7, 1, 12, 0)), "tomorrow");
  assert.equal(birthdayReminderState(birthday, new Date(2026, 7, 2, 12, 0)), "today");
  assert.deepEqual(birthdaysForDate([birthday], "2030-08-02").map((item) => item.id), ["b1"]);
});

test("Telegram birthday copy matches confirmed wording", () => {
  assert.equal(birthdayMessage("Сергей", "tomorrow"), "Завтра день рождения: Сергей");
  assert.equal(birthdayMessage("Сергей", "today"), "Сегодня день рождения: Сергей");
});

test("scheduled local time is converted to UTC", () => {
  assert.equal(zonedDateTimeToUtc("2026-08-01", "12:00", "Europe/Saratov"), "2026-08-01T08:00:00.000Z");
});

test("birthday scheduler respects record timezone", () => {
  assert.deepEqual(nextBirthdayDates(8, 2, "Europe/Saratov", new Date("2026-08-01T08:00:00Z")), { today: false, tomorrow: true });
});
