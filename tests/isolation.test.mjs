import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scopedRecordId } from "../server/security.ts";

test("the same local record receives a different server id for each device", async () => {
  const first = await scopedRecordId("device-a", "task-1", "calendar-item");
  const second = await scopedRecordId("device-b", "task-1", "calendar-item");
  assert.notEqual(first, second);
  assert.equal(first, await scopedRecordId("device-a", "task-1", "calendar-item"));
  assert.equal(first.includes("task-1"), false);
});

test("calendar operations keep an explicit device ownership condition", async () => {
  const source = await readFile(new URL("../server/calendar.ts", import.meta.url), "utf8");
  assert.match(source, /google_connections WHERE device_id = \?1/);
  assert.match(source, /calendar_items WHERE local_id = \?1 AND device_id = \?2/);
  assert.match(source, /reminders SET status='cancelled' WHERE local_id=\?1 AND device_id=\?2/);
});
