import test from "node:test";
import assert from "node:assert/strict";
import { entryIsDue, ideaRevisitDate, localDateKey, sortEntries } from "../app/records.ts";

test("idea revisit date is seven device-local days later", () => {
  const created = new Date(2026, 6, 30, 23, 45);
  assert.equal(ideaRevisitDate(created), "2026-08-06");
});

test("date keys use the device-local calendar date", () => {
  assert.equal(localDateKey(new Date(2026, 0, 5, 8, 0)), "2026-01-05");
});

test("overdue and timed tasks become due, completed tasks do not", () => {
  const base = { id: "1", type: "task", text: "Тест", createdAt: "2026-07-29T10:00:00.000Z", updatedAt: "2026-07-29T10:00:00.000Z", status: "active" };
  assert.equal(entryIsDue({ ...base, date: "2026-07-29" }, new Date(2026, 6, 30, 9, 0)), true);
  assert.equal(entryIsDue({ ...base, date: "2026-07-30", time: "10:00" }, new Date(2026, 6, 30, 9, 0)), false);
  assert.equal(entryIsDue({ ...base, date: "2026-07-30", time: "08:30" }, new Date(2026, 6, 30, 9, 0)), true);
  assert.equal(entryIsDue({ ...base, date: "2026-07-29", status: "completed" }, new Date(2026, 6, 30, 9, 0)), false);
});

test("ideas due today or earlier return to attention", () => {
  const idea = { id: "i", type: "idea", text: "Идея", createdAt: "2026-07-23T10:00:00.000Z", updatedAt: "2026-07-23T10:00:00.000Z", status: "active", revisitDate: "2026-07-30" };
  assert.equal(entryIsDue(idea, new Date(2026, 6, 30, 9, 0)), true);
  assert.equal(entryIsDue({ ...idea, reviewedAt: "2026-07-30T09:05:00.000Z" }, new Date(2026, 6, 30, 9, 10)), false);
});

test("scheduled entries sort by date and time", () => {
  const common = { type: "task", text: "Задача", createdAt: "2026-07-30T10:00:00.000Z", updatedAt: "2026-07-30T10:00:00.000Z", status: "active" };
  const sorted = sortEntries([
    { ...common, id: "late", date: "2026-07-30", time: "18:00" },
    { ...common, id: "early", date: "2026-07-30", time: "09:00" },
  ]);
  assert.deepEqual(sorted.map((entry) => entry.id), ["early", "late"]);
});
