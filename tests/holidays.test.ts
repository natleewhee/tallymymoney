// dayCount is holiday mode's one pure function — everything else in
// lib/holidays.ts touches the database or the Telegram bot instance, so
// this is what a unit test can actually cover without a live DB.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dayCount } from "../lib/holidays.ts";

test("dayCount: the start day itself is day 1", () => {
  const start = new Date("2026-08-11T05:00:00Z");
  assert.equal(dayCount(start, start), 1);
});

test("dayCount: just under 24 hours later is still day 1", () => {
  const start = new Date("2026-08-11T05:00:00Z");
  const asOf = new Date("2026-08-12T04:59:59Z");
  assert.equal(dayCount(start, asOf), 1);
});

test("dayCount: exactly 24 hours later is day 2", () => {
  const start = new Date("2026-08-11T05:00:00Z");
  const asOf = new Date("2026-08-12T05:00:00Z");
  assert.equal(dayCount(start, asOf), 2);
});

test("dayCount: a week-long trip", () => {
  const start = new Date("2026-08-11T05:00:00Z");
  const asOf = new Date("2026-08-18T05:00:01Z");
  assert.equal(dayCount(start, asOf), 8);
});
